// Follows the site's reset time. When a run meets an active usage limit and the page says when
// it resets, a repeating schedule that opted in moves its time of day to just after that reset.

import { mutate } from './storage.js';
import { retimeTrigger } from '../core/resync.js';
import { syncAlarms } from './system.js';

const DAY = 86400000;

/** Returns true when the schedule's time was changed. */
export async function applyResetSync(scheduleId, resetAt, now = Date.now()) {
  if (!resetAt || resetAt <= now || resetAt - now > DAY) return false;
  const changed = await mutate((data) => {
    const s = data.schedules.find((x) => x.id === scheduleId);
    if (!s || !s.resetSync || !s.resetSync.enabled || s.trigger.type !== 'daily') return false;
    const { trigger, targetMs } = retimeTrigger(s.trigger, resetAt, s.resetSync.bufferMin);
    s.resetSync.lastResetAt = resetAt;
    s.resetSync.lastSyncedAt = now;
    if (trigger.time === s.trigger.time) return false;
    s.trigger = trigger;
    // The run in progress keeps trying until after this reset, so it already covers today's
    // occurrence of the new time. Mark it handled so the same reset never starts a second run.
    s.handledUpTo = Math.max(s.handledUpTo ?? 0, targetMs);
    s.revision = (s.revision || 0) + 1;
    s.updatedAt = now;
    return true;
  });
  if (changed) await syncAlarms();
  return changed;
}
