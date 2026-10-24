// Moves a schedule's trigger to match a reset time read from the chat site. Pure functions.

import { partsInTz, toLocalInput } from './time.js';

export const RESYNC = { bufferDefault: 1, bufferMax: 60 };

const pad = (n) => String(n).padStart(2, '0');

/**
 * The trigger that fires `bufferMin` minutes after the reset, rounded up to a whole minute,
 * in the trigger's own time zone. A repeating trigger keeps its days and only changes the time of day.
 * Returns { trigger, targetMs }.
 */
export function retimeTrigger(trigger, resetAtMs, bufferMin = RESYNC.bufferDefault) {
  const buffer = Math.min(RESYNC.bufferMax, Math.max(0, Number(bufferMin) || 0));
  const targetMs = Math.ceil((resetAtMs + buffer * 60000) / 60000) * 60000;
  if (trigger.type === 'once') {
    return { trigger: { ...trigger, at: toLocalInput(targetMs, trigger.tz) }, targetMs };
  }
  const p = partsInTz(targetMs, trigger.tz);
  return { trigger: { ...trigger, time: `${pad(p.h)}:${pad(p.mi)}` }, targetMs };
}
