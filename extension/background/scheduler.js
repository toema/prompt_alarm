// Scheduler: turns due occurrences into runs. It never trusts an alarm as proof that
// something is due; it recomputes from the stored schedules and the wall clock every time,
// so late alarms, a sleeping computer and a closed browser are all handled the same way.

import { mutate, pruneRuns, isActive } from './storage.js';
import { nextOccurrenceAfter } from '../core/time.js';
import { makeRun, finishedRun, pump } from './orchestrator.js';
import { syncAlarms, syncKeepAwake, syncWatchdog, updateBadge } from './system.js';

const DAY = 86400000;

export async function reconcile(reason = '') {
  const now = Date.now();
  await mutate((data) => {
    const { settings, schedules, runs } = data;
    for (const s of schedules) {
      if (!s.enabled) continue;
      let after = s.handledUpTo ?? s.createdAt ?? now;
      const due = [];
      for (let guard = 0; guard < 500; guard++) {
        const occ = nextOccurrenceAfter(s.trigger, after);
        if (occ === null || occ > now + 1000) break;
        due.push(occ);
        after = occ;
      }
      if (!due.length) continue;
      s.handledUpTo = due[due.length - 1];

      due.forEach((t, i) => {
        const latest = i === due.length - 1;
        const age = now - t;
        if (settings.paused) {
          if (age <= 7 * DAY) runs.unshift(finishedRun(s, t, 'skipped', 'PAUSED', now));
        } else if (latest && age <= s.graceMin * 60000) {
          if (runs.some((r) => r.scheduleId === s.id && isActive(r))) {
            runs.unshift(finishedRun(s, t, 'skipped', 'PREVIOUS_RUN_ACTIVE', now));
          } else {
            runs.unshift(makeRun(s, t, false, now));
          }
        } else if (age <= 7 * DAY) {
          runs.unshift(finishedRun(s, t, 'missed', 'MISSED_WINDOW', now));
        }
      });

      if (s.trigger.type === 'once') s.enabled = false;
    }
    pruneRuns(data);
  });
  await syncAlarms();
  await syncKeepAwake();
  await syncWatchdog();
  await updateBadge();
  await pump();
}

export async function startManualRun(scheduleId) {
  const now = Date.now();
  const out = await mutate((data) => {
    const s = data.schedules.find((x) => x.id === scheduleId);
    if (!s) return { ok: false, error: 'Schedule not found.' };
    if (data.runs.some((r) => r.scheduleId === s.id && isActive(r))) {
      return { ok: false, error: 'A run of this schedule is already active.' };
    }
    data.runs.unshift(makeRun(s, now, true, now));
    return { ok: true };
  });
  if (out.ok) {
    await syncWatchdog();
    pump().catch((e) => console.warn('[PromptAlarm] pump failed', e));
  }
  return out;
}
