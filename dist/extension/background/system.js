// Browser-facing housekeeping shared by the scheduler, orchestrator and message handler:
// alarms, keep-awake, toolbar badge and notifications.

import { load, isActive } from './storage.js';
import { nextOccurrenceAfter } from '../core/time.js';
import { reasonText } from '../shared/reasons.js';

const HOUR = 3600000;

/** Next time a schedule fires, strictly after now. */
export function nextRunFor(schedule, now = Date.now()) {
  if (!schedule.enabled) return null;
  return nextOccurrenceAfter(schedule.trigger, Math.max(schedule.handledUpTo ?? 0, now));
}

export async function ensureBaseAlarms() {
  if (!(await chrome.alarms.get('reconcile'))) {
    chrome.alarms.create('reconcile', { periodInMinutes: 15, delayInMinutes: 1 });
  }
}

/** One alarm per enabled schedule, named sched:<id>, set to its next fire time. */
export async function syncAlarms() {
  const { schedules } = await load();
  const want = new Map();
  for (const s of schedules) {
    const when = nextRunFor(s);
    if (when) want.set('sched:' + s.id, when);
  }
  const existing = await chrome.alarms.getAll();
  for (const a of existing) {
    if (!a.name.startsWith('sched:')) continue;
    const when = want.get(a.name);
    if (when === undefined) {
      await chrome.alarms.clear(a.name);
    } else if (Math.abs(a.scheduledTime - when) <= 1000) {
      want.delete(a.name);
    }
  }
  for (const [name, when] of want) chrome.alarms.create(name, { when });
}

/** While any run is active a one-minute watchdog alarm resumes runs a stopped worker left behind. */
export async function syncWatchdog() {
  const { runs } = await load();
  const has = runs.some(isActive);
  const alarm = await chrome.alarms.get('watchdog');
  if (has && !alarm) chrome.alarms.create('watchdog', { periodInMinutes: 1, delayInMinutes: 1 });
  if (!has && alarm) await chrome.alarms.clear('watchdog');
}

/** Keeps the computer awake only when the user opted in and a run is active or due within 12 hours. */
export async function syncKeepAwake() {
  if (!chrome.power) return; // optional permission not granted
  const { settings, schedules, runs } = await load();
  const horizon = Date.now() + 12 * HOUR;
  const soon = schedules.some((s) => {
    const n = nextRunFor(s);
    return n !== null && n <= horizon;
  });
  const wanted = settings.keepAwake && !settings.paused && (soon || runs.some(isActive));
  if (wanted) chrome.power.requestKeepAwake('system');
  else chrome.power.releaseKeepAwake();
}

export async function updateBadge() {
  const { settings, runs } = await load();
  const attention = runs.some((r) => r.status === 'failed' && (r.endedAt ?? 0) > (settings.lastSeenAt || 0));
  const active = runs.some(isActive);
  let text = '';
  let color = '#5b6475';
  if (attention) {
    text = '!';
    color = '#c5221f';
  } else if (settings.paused) {
    text = 'II';
  } else if (active) {
    text = '...';
    color = '#1a73e8';
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

export async function notifyFinish(run, settings) {
  if (!settings.notifications || !chrome.notifications) return;
  if (!['sent', 'failed', 'missed'].includes(run.status)) return;
  const ok = run.status === 'sent';
  try {
    await chrome.notifications.create(run.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `${run.scheduleName}: ${ok ? 'prompt sent' : 'not sent'}`,
      message: reasonText(run.reasonCode) || (ok ? 'The prompt was sent.' : 'See the run history for details.'),
    });
  } catch (e) {
    /* notifications are best-effort */
  }
}
