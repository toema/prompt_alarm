// Helpers shared by the popup and the dashboard. No innerHTML anywhere: names, prompts and
// reasons are user data and are always set as text.

import { DEFAULT_SETTINGS } from '../background/storage.js';
import { formatWhen, formatClock, formatCountdown } from '../core/time.js';
import { PROVIDERS } from '../shared/providers.js';
import { nextOccurrenceAfter } from '../core/time.js';

export { formatWhen, formatClock, formatCountdown };

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function send(type, payload) {
  return chrome.runtime.sendMessage({ type, ...(payload || {}) });
}

export async function readState() {
  const d = await chrome.storage.local.get(['settings', 'schedules', 'runs']);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    schedules: Array.isArray(d.schedules) ? d.schedules : [],
    runs: Array.isArray(d.runs) ? d.runs : [],
  };
}

export const providerName = (id) => (PROVIDERS[id] ? PROVIDERS[id].name : id);

export function nextRunOf(schedule, now = Date.now()) {
  if (!schedule.enabled) return null;
  return nextOccurrenceAfter(schedule.trigger, Math.max(schedule.handledUpTo ?? 0, now));
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeTrigger(t) {
  if (!t) return '';
  if (t.type === 'once') return `Once, ${formatWhen(nextOccurrenceAfter({ ...t }, 0) ?? Date.parse(t.at), t.tz)}`;
  const [hh, mm] = t.time.split(':').map(Number);
  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hh, mm));
  const days = t.days || [];
  let when;
  if (days.length === 7) when = 'Every day';
  else if (days.join() === '1,2,3,4,5') when = 'Weekdays';
  else if (days.join() === '0,6') when = 'Weekends';
  else when = days.map((d) => DAY_NAMES[d]).join(', ');
  return `${when} at ${clock}`;
}

export function activeRunOf(runs, scheduleId) {
  return runs.find((r) => r.scheduleId === scheduleId && ['queued', 'running', 'blocked'].includes(r.status)) || null;
}

export function runLine(run) {
  if (!run) return '';
  if (run.status === 'blocked') {
    return `Limit still active. Trying again at ${formatClock(run.cursor?.nextAt)}.`;
  }
  if (run.status === 'queued') return 'Starting.';
  return run.cursor?.phase === 'await' ? 'Message sent. Waiting for the reply.' : 'Sending now.';
}

export const STATUS = {
  sent: { label: 'Sent', tone: 'good' },
  failed: { label: 'Not sent', tone: 'bad' },
  blocked: { label: 'Waiting to retry', tone: 'warn' },
  running: { label: 'Running', tone: '' },
  queued: { label: 'Starting', tone: '' },
  missed: { label: 'Missed', tone: 'warn' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export function statusChip(status) {
  const s = STATUS[status] || { label: status, tone: 'neutral' };
  return h('span', { class: `chip ${s.tone}`.trim() }, s.label);
}

/** The "next run" night panel, shared by the popup and the dashboard. */
export function paintNight(root, { schedules, settings, runs }, now = Date.now()) {
  const active = runs.find((r) => ['queued', 'running', 'blocked'].includes(r.status));
  const upcoming = schedules
    .map((s) => ({ s, at: nextRunOf(s, now) }))
    .filter((x) => x.at !== null)
    .sort((a, b) => a.at - b.at)[0];

  const label = root.querySelector('[data-night="label"]');
  const time = root.querySelector('[data-night="time"]');
  const until = root.querySelector('[data-night="until"]');
  const fill = root.querySelector('[data-night="fill"]');
  const note = root.querySelector('[data-night="note"]');
  time.replaceChildren();
  fill.style.width = '0%';
  note.textContent = '';

  if (settings.paused) {
    label.textContent = 'Paused';
    time.append('Nothing will run');
    time.style.fontSize = '26px';
    until.textContent = 'Turn PromptAlarm back on to resume your schedules.';
    return;
  }
  time.style.fontSize = '';
  if (active && active.status === 'blocked') {
    label.textContent = `${active.scheduleName}: waiting for the limit to reset`;
    appendClock(time, active.cursor.nextAt);
    until.textContent = `Next attempt ${formatCountdown(active.cursor.nextAt, now)}`;
    return;
  }
  if (active) {
    label.textContent = active.scheduleName;
    time.append('Running');
    time.style.fontSize = '30px';
    until.textContent = runLine(active);
    return;
  }
  if (!upcoming) {
    label.textContent = 'Next run';
    time.append('Nothing scheduled');
    time.style.fontSize = '26px';
    until.textContent = 'Add a schedule and it will show up here.';
    return;
  }
  label.textContent = `Next run: ${upcoming.s.name}`;
  appendClock(time, upcoming.at, upcoming.s.trigger.tz);
  until.textContent = `${formatWhen(upcoming.at, upcoming.s.trigger.tz)}, ${formatCountdown(upcoming.at, now)}`;
  const span = 12 * 3600000;
  const left = Math.max(0, upcoming.at - now);
  fill.style.width = `${Math.round((1 - Math.min(1, left / span)) * 100)}%`;
  note.textContent = left > span ? 'More than 12 hours to go' : 'Progress toward the next 12 hours';
}

function appendClock(el, ms, tz) {
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }).formatToParts(new Date(ms));
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod');
  el.append(parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim());
  if (dayPeriod) el.append(h('small', null, dayPeriod.value));
}

export function nightMarkup() {
  return h(
    'section',
    { class: 'night', 'aria-live': 'polite' },
    h('div', { class: 'label', 'data-night': 'label' }),
    h('div', { class: 'time', 'data-night': 'time' }),
    h('div', { class: 'until', 'data-night': 'until' }),
    h('div', { class: 'track', 'aria-hidden': 'true' }, h('i', { 'data-night': 'fill' })),
    h('div', { class: 'track-note', 'data-night': 'note' })
  );
}

/** Plain-language result of "Check this page". */
export function selfTestText(res) {
  if (!res || !res.ok) return { ok: false, text: (res && res.error) || 'The check could not run.' };
  const r = res.result;
  if (!r || !r.adapter) return { ok: false, text: 'This site is not supported.' };
  if (r.signedOut) return { ok: false, text: 'The page asks you to sign in. Sign in, then check again.' };
  if (!r.composerFound) {
    return {
      ok: false,
      text: 'The message box was not found. The page may still be loading, or the site changed and PromptAlarm needs an update.',
    };
  }
  const bits = ['Found the message box.'];
  if (r.composerEmpty === false) bits.push('It already has unsent text, so a run would stop.');
  if (r.limitNotice) bits.push('A usage limit notice is showing.');
  else bits.push('No usage limit notice.');
  return { ok: true, text: bits.join(' ') };
}
