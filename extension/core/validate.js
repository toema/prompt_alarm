import { normalizeTargetUrl } from '../shared/providers.js';
import { isValidTimeZone, nextOccurrenceAfter } from './time.js';
import { RESYNC } from './resync.js';

export const LIMITS = {
  nameMax: 80,
  promptMax: 20000,
  stepsMax: 10,
  retryIntervalMinMin: 0.05, // fractional minutes allow fast end-to-end tests; the UI asks for >= 1
  retryIntervalMinMax: 1440,
  retryWindowMax: 1440,
  graceMax: 1440,
  capMax: 10,
};

const num = (v, fallback) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v));

/**
 * Validates and normalizes a schedule coming from the UI or an import file.
 * Returns { ok, errors, value }. `value` never contains unknown fields.
 */
export function validateSchedule(input, { now = Date.now(), isNew = true } = {}) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  const name = String(src.name ?? '').trim().slice(0, LIMITS.nameMax) || 'Untitled schedule';

  const target = normalizeTargetUrl(src.target?.url ?? src.url);
  if (!target.ok) errors.push(target.error);

  const t = src.trigger || {};
  const tz = t.tz;
  let trigger = null;
  if (!isValidTimeZone(tz)) {
    errors.push('Choose a valid time zone.');
  } else if (t.type === 'once') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t.at || '')) {
      errors.push('Pick a date and time.');
    } else {
      trigger = { type: 'once', at: t.at.slice(0, 16), tz };
      const next = nextOccurrenceAfter(trigger, now);
      if (isNew && next === null) errors.push('That time is already in the past.');
    }
  } else if (t.type === 'daily') {
    const days = Array.isArray(t.days) ? [...new Set(t.days.map(Number))].filter((d) => d >= 0 && d <= 6).sort() : [];
    if (!/^\d{1,2}:\d{2}$/.test(t.time || '')) errors.push('Pick a time of day.');
    else if (days.length === 0) errors.push('Pick at least one weekday.');
    else {
      trigger = { type: 'daily', time: t.time, days, tz };
      if (nextOccurrenceAfter(trigger, now) === null) errors.push('Pick a valid time of day.');
    }
  } else {
    errors.push('Choose when to run.');
  }

  const rawSteps = Array.isArray(src.steps) ? src.steps : [];
  const steps = rawSteps
    .map((s, i) => ({
      id: String(s?.id || `step-${i + 1}`),
      text: String(s?.text ?? '').trim(),
      waitForReply: s?.waitForReply !== false,
      timeoutSec: Math.min(3600, Math.max(10, num(s?.timeoutSec, 600))),
    }))
    .filter((s) => s.text.length > 0);
  if (steps.length === 0) errors.push('Write the prompt to send.');
  if (steps.length > LIMITS.stepsMax) errors.push(`Use at most ${LIMITS.stepsMax} prompts per run.`);
  if (steps.some((s) => s.text.length > LIMITS.promptMax)) {
    errors.push(`A prompt is longer than ${LIMITS.promptMax} characters.`);
  }

  const r = src.retry || {};
  const retry = {
    enabled: r.enabled !== false,
    intervalMin: num(r.intervalMin, 10),
    windowMin: num(r.windowMin, 360),
  };
  if (retry.intervalMin < LIMITS.retryIntervalMinMin || retry.intervalMin > LIMITS.retryIntervalMinMax) {
    errors.push('Retry interval must be between 1 minute and 24 hours.');
  }
  if (retry.windowMin < 0 || retry.windowMin > LIMITS.retryWindowMax) {
    errors.push('Retry window must be between 0 and 24 hours.');
  }

  const graceMin = num(src.graceMin, 120);
  if (graceMin < 0 || graceMin > LIMITS.graceMax) errors.push('Grace period must be between 0 and 24 hours.');

  let maxMessagesPerRun = Math.round(num(src.maxMessagesPerRun, 1));
  if (maxMessagesPerRun < 1 || maxMessagesPerRun > LIMITS.capMax) errors.push('Message cap must be between 1 and 10.');
  maxMessagesPerRun = Math.min(LIMITS.capMax, Math.max(1, maxMessagesPerRun));

  const rs = src.resetSync || {};
  const resetSync = {
    enabled: rs.enabled === true,
    bufferMin: Math.min(RESYNC.bufferMax, Math.max(0, Math.round(num(rs.bufferMin, RESYNC.bufferDefault)))),
  };

  if (errors.length) return { ok: false, errors, value: null };

  return {
    ok: true,
    errors: [],
    value: {
      name,
      enabled: src.enabled !== false,
      target: { provider: target.provider, url: target.url },
      trigger,
      steps,
      retry,
      graceMin,
      maxMessagesPerRun,
      overwriteDraft: src.overwriteDraft === true,
      resetSync,
    },
  };
}
