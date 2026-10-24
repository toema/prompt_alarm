import { partsInTz, localTimeZone } from './time.js';

const pad = (n) => String(n).padStart(2, '0');

/** Fills {{date}}, {{time}} and {{runNumber}}. Unknown variables are left as typed. */
export function renderPrompt(text, { now = Date.now(), runNumber = 1, tz } = {}) {
  const p = partsInTz(now, tz || localTimeZone());
  const vars = {
    date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`,
    time: `${pad(p.h)}:${pad(p.mi)}`,
    runNumber: String(runNumber),
  };
  return String(text).replace(/\{\{\s*(date|time|runNumber)\s*\}\}/g, (_, k) => vars[k]);
}
