// The only way the UI changes data: typed messages to the service worker, which validates
// everything, saves it, and re-syncs alarms in one step.

import { mutate, load, isActive } from './storage.js';
import { validateSchedule } from '../core/validate.js';
import { startManualRun, reconcile } from './scheduler.js';
import { cancelRun, selfTestUrl, detectResetUrl } from './orchestrator.js';
import { nextRunFor, syncAlarms, syncKeepAwake, updateBadge } from './system.js';

const SETTING_KEYS = ['paused', 'keepAwake', 'notifications', 'logRetentionDays'];

async function resync() {
  await syncAlarms();
  await syncKeepAwake();
  await updateBadge();
}

async function saveSchedule(input) {
  const now = Date.now();
  const out = await mutate((data) => {
    const existing = data.schedules.find((s) => s.id === input?.id) || null;
    const triggerSame = existing && JSON.stringify(existing.trigger) === JSON.stringify(input?.trigger);
    const v = validateSchedule(input, { now, isNew: !triggerSame });
    if (!v.ok) return { ok: false, errors: v.errors };
    const s = existing || {
      id: crypto.randomUUID(),
      createdAt: now,
      handledUpTo: now,
      runCount: 0,
      revision: 0,
    };
    const triggerChanged = existing && !triggerSame;
    const reEnabled = existing && !existing.enabled && v.value.enabled;
    const prevSync = existing ? existing.resetSync : null;
    Object.assign(s, v.value);
    // Keep what was last read from the site; only the settings come from the form.
    if (prevSync) s.resetSync = { ...prevSync, ...v.value.resetSync };
    s.revision = (s.revision || 0) + 1;
    s.updatedAt = now;
    if (!existing || triggerChanged || reEnabled) s.handledUpTo = now;
    if (!existing) data.schedules.push(s);
    return { ok: true, schedule: structuredClone(s) };
  });
  if (out.ok) await resync();
  return out;
}

async function toggleSchedule(id, enabled) {
  const now = Date.now();
  const out = await mutate((data) => {
    const s = data.schedules.find((x) => x.id === id);
    if (!s) return { ok: false, error: 'Schedule not found.' };
    if (enabled) {
      s.handledUpTo = now;
      if (nextRunFor({ ...s, enabled: true }, now) === null) {
        return { ok: false, error: 'This schedule has no upcoming time. Edit it and pick a new time.' };
      }
    }
    s.enabled = !!enabled;
    return { ok: true };
  });
  if (out.ok) await resync();
  return out;
}

async function deleteSchedule(id) {
  await mutate((data) => {
    data.schedules = data.schedules.filter((s) => s.id !== id);
  });
  await resync();
  return { ok: true };
}

async function duplicateSchedule(id) {
  const now = Date.now();
  const out = await mutate((data) => {
    const s = data.schedules.find((x) => x.id === id);
    if (!s) return { ok: false, error: 'Schedule not found.' };
    const copy = structuredClone(s);
    copy.id = crypto.randomUUID();
    copy.name = `${s.name} (copy)`.slice(0, 80);
    copy.enabled = false;
    copy.createdAt = now;
    copy.handledUpTo = now;
    copy.runCount = 0;
    copy.revision = 1;
    delete copy.lastRunAt;
    data.schedules.push(copy);
    return { ok: true, id: copy.id };
  });
  return out;
}

async function updateSettings(patch) {
  await mutate((data) => {
    for (const k of SETTING_KEYS) {
      if (patch && k in patch) data.settings[k] = patch[k];
    }
    data.settings.logRetentionDays = Math.min(365, Math.max(1, Number(data.settings.logRetentionDays) || 30));
  });
  await resync();
  return { ok: true };
}

async function clearHistory() {
  await mutate((data) => {
    data.runs = data.runs.filter(isActive);
  });
  await updateBadge();
  return { ok: true };
}

async function exportData() {
  const { schedules } = await load();
  return {
    ok: true,
    data: {
      app: 'PromptAlarm',
      version: 1,
      exportedAt: new Date().toISOString(),
      schedules: schedules.map((s) => ({
        name: s.name,
        enabled: s.enabled,
        target: { url: s.target.url },
        trigger: s.trigger,
        steps: s.steps,
        retry: s.retry,
        graceMin: s.graceMin,
        maxMessagesPerRun: s.maxMessagesPerRun,
        overwriteDraft: s.overwriteDraft,
        resetSync: s.resetSync ? { enabled: s.resetSync.enabled, bufferMin: s.resetSync.bufferMin } : undefined,
      })),
    },
  };
}

async function importData(file) {
  if (!file || file.app !== 'PromptAlarm' || !Array.isArray(file.schedules)) {
    return { ok: false, error: 'This is not a PromptAlarm export file.' };
  }
  const now = Date.now();
  const skipped = [];
  let imported = 0;
  await mutate((data) => {
    file.schedules.slice(0, 200).forEach((raw, i) => {
      const v = validateSchedule(raw, { now, isNew: false });
      if (!v.ok) {
        skipped.push(`#${i + 1} ${raw?.name || ''}: ${v.errors[0]}`);
        return;
      }
      const s = {
        id: crypto.randomUUID(),
        createdAt: now,
        handledUpTo: now,
        runCount: 0,
        revision: 1,
        updatedAt: now,
        ...v.value,
      };
      s.enabled = v.value.enabled && nextRunFor({ ...s, enabled: true }, now) !== null;
      data.schedules.push(s);
      imported++;
    });
  });
  await resync();
  return { ok: true, imported, skipped };
}

export async function handleMessage(msg) {
  switch (msg && msg.type) {
    case 'schedule/save':
      return saveSchedule(msg.schedule);
    case 'schedule/toggle':
      return toggleSchedule(msg.id, msg.enabled);
    case 'schedule/delete':
      return deleteSchedule(msg.id);
    case 'schedule/duplicate':
      return duplicateSchedule(msg.id);
    case 'schedule/runNow':
      return startManualRun(msg.id);
    case 'run/cancel':
      await cancelRun(msg.id);
      return { ok: true };
    case 'settings/update':
      return updateSettings(msg.patch);
    case 'history/clear':
      return clearHistory();
    case 'data/export':
      return exportData();
    case 'data/import':
      return importData(msg.file);
    case 'target/selfTest':
      return selfTestUrl(msg.url);
    case 'target/detectReset':
      return detectResetUrl(msg.url);
    case 'seen':
      await mutate((data) => {
        data.settings.lastSeenAt = Date.now();
      });
      await updateBadge();
      return { ok: true };
    case 'reconcile':
      await reconcile('message');
      return { ok: true };
    case 'ping':
      return { ok: true };
    default:
      return { ok: false, error: 'Unknown request.' };
  }
}
