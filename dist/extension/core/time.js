// Time-zone aware schedule math. Pure functions, no browser APIs except Intl.
// A trigger stores a local wall-clock time plus an IANA zone, never a fixed offset.

const dtfCache = new Map();

function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Calendar fields of an instant as seen in a zone. */
export function partsInTz(ms, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') o[p.type] = Number(p.value);
  }
  if (o.hour === 24) o.hour = 0;
  return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}

/** Offset of the zone from UTC at an instant, in ms (positive east of UTC). */
export function tzOffsetMs(ms, tz) {
  const p = partsInTz(ms, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Instant of a local wall-clock time in a zone.
 * Ambiguous time (clocks go back): the first occurrence.
 * Nonexistent time (clocks jump forward): shifted forward by the gap.
 */
export function zonedToMs(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(guess, tz);
  const t1 = guess - off1;
  const off2 = tzOffsetMs(t1, tz);
  if (off1 === off2) return t1;
  const t2 = guess - off2;
  const off3 = tzOffsetMs(t2, tz);
  if (off3 === off2) return t2;
  return Math.max(t1, t2);
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DDTHH:mm' for an instant in a zone (the value of a datetime-local input). */
export function toLocalInput(ms, tz) {
  const p = partsInTz(ms, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** First occurrence of a trigger strictly after `afterMs`, or null. */
export function nextOccurrenceAfter(trigger, afterMs) {
  if (!trigger || !isValidTimeZone(trigger.tz)) return null;
  const tz = trigger.tz;

  if (trigger.type === 'once') {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(trigger.at || '');
    if (!m) return null;
    const ms = zonedToMs(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
    return ms > afterMs ? ms : null;
  }

  if (trigger.type === 'daily') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(trigger.time || '');
    if (!m) return null;
    const hh = +m[1];
    const mm = +m[2];
    if (hh > 23 || mm > 59) return null;
    const days = Array.isArray(trigger.days) && trigger.days.length ? trigger.days : [0, 1, 2, 3, 4, 5, 6];
    const start = partsInTz(afterMs, tz);
    for (let i = 0; i < 9; i++) {
      const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
      if (!days.includes(day.getUTCDay())) continue;
      const ms = zonedToMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
      if (ms > afterMs) return ms;
    }
    return null;
  }

  return null;
}

export function formatWhen(ms, tz) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz || undefined,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function formatClock(ms, tz) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz || undefined,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}

export function formatCountdown(ms, now = Date.now()) {
  let s = Math.round((ms - now) / 1000);
  if (s <= 0) return 'now';
  if (s < 60) return 'in under a minute';
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `in ${d} d ${h} h`;
  if (h > 0) return `in ${h} h ${m} min`;
  return `in ${m} min`;
}
