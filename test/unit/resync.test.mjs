import test from 'node:test';
import assert from 'node:assert/strict';
import { retimeTrigger } from '../../extension/core/resync.js';
import { nextOccurrenceAfter, zonedToMs } from '../../extension/core/time.js';
import { validateSchedule } from '../../extension/core/validate.js';

const CAIRO = 'Africa/Cairo';
const base = {
  name: 'n',
  url: 'https://claude.ai/chat/abc',
  trigger: { type: 'daily', time: '05:00', days: [0, 1, 2, 3, 4, 5, 6], tz: CAIRO },
  steps: [{ text: 'continue' }],
};

test('retimeTrigger: daily moves the time of day, in the schedule zone, after the buffer', () => {
  const reset = zonedToMs(2024, 6, 7, 7, 30, CAIRO);
  const { trigger, targetMs } = retimeTrigger(base.trigger, reset, 2);
  assert.equal(trigger.time, '07:32');
  assert.deepEqual(trigger.days, base.trigger.days);
  assert.equal(targetMs, zonedToMs(2024, 6, 7, 7, 32, CAIRO));
});

test('retimeTrigger: a reset with stray seconds rounds up to the next minute', () => {
  const reset = zonedToMs(2024, 6, 7, 7, 30, CAIRO) + 20000;
  assert.equal(retimeTrigger(base.trigger, reset, 0).trigger.time, '07:31');
});

test('retimeTrigger: a zone different from the browser zone is respected', () => {
  const reset = Date.UTC(2024, 5, 7, 12, 0); // 12:00 UTC = 15:00 in Cairo (UTC+3 in summer)
  assert.equal(retimeTrigger({ ...base.trigger, tz: 'UTC' }, reset, 0).trigger.time, '12:00');
  assert.equal(retimeTrigger(base.trigger, reset, 0).trigger.time, '15:00');
});

test('retimeTrigger: once sets the date and time', () => {
  const reset = zonedToMs(2024, 6, 8, 0, 10, CAIRO);
  const { trigger } = retimeTrigger({ type: 'once', at: '2024-06-07T05:00', tz: CAIRO }, reset, 1);
  assert.equal(trigger.at, '2024-06-08T00:11');
});

test('validate: resetSync defaults off, and the buffer is clamped', () => {
  assert.deepEqual(validateSchedule(base).value.resetSync, { enabled: false, bufferMin: 1 });
  const v = validateSchedule({ ...base, resetSync: { enabled: true, bufferMin: 999 } });
  assert.deepEqual(v.value.resetSync, { enabled: true, bufferMin: 60 });
  assert.equal(validateSchedule({ ...base, resetSync: { enabled: 'yes' } }).value.resetSync.enabled, false);
});

// ---- applyResetSync against an in-memory chrome.storage

function fakeChrome(initial) {
  const store = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
        set: async (patch) => Object.assign(store, structuredClone(patch)),
      },
    },
    alarms: { getAll: async () => [], get: async () => null, create() {}, clear: async () => true },
  };
  return store;
}

test('applyResetSync: moves a daily schedule once, and today is not run again', async () => {
  const { applyResetSync } = await import('../../extension/background/resync.js');
  const now = zonedToMs(2024, 6, 7, 5, 0, CAIRO);
  const reset = zonedToMs(2024, 6, 7, 9, 0, CAIRO);
  const sched = {
    id: 's1',
    enabled: true,
    trigger: { ...base.trigger },
    handledUpTo: now, // the 05:00 occurrence started the run that is now waiting
    resetSync: { enabled: true, bufferMin: 1 },
  };
  const store = fakeChrome({ schedules: [sched], runs: [], settings: {} });

  assert.equal(await applyResetSync('s1', reset, now), true);
  const s = store.schedules[0];
  assert.equal(s.trigger.time, '09:01');
  assert.equal(s.resetSync.lastResetAt, reset);
  assert.equal(nextOccurrenceAfter(s.trigger, s.handledUpTo), zonedToMs(2024, 6, 8, 9, 1, CAIRO));

  // reading the same reset again changes nothing
  assert.equal(await applyResetSync('s1', reset, now), false);
});

test('applyResetSync: ignores schedules that did not opt in, once triggers, and implausible times', async () => {
  const { applyResetSync } = await import('../../extension/background/resync.js');
  const now = Date.now();
  const store = fakeChrome({
    schedules: [
      { id: 'a', trigger: { ...base.trigger }, resetSync: { enabled: false, bufferMin: 1 } },
      { id: 'b', trigger: { type: 'once', at: '2030-01-01T05:00', tz: CAIRO }, resetSync: { enabled: true, bufferMin: 1 } },
      { id: 'c', trigger: { ...base.trigger }, resetSync: { enabled: true, bufferMin: 1 } },
    ],
    runs: [],
    settings: {},
  });
  assert.equal(await applyResetSync('a', now + 3600000, now), false);
  assert.equal(await applyResetSync('b', now + 3600000, now), false);
  assert.equal(await applyResetSync('c', now - 1000, now), false);
  assert.equal(await applyResetSync('c', now + 30 * 3600000, now), false);
  assert.equal(store.schedules[2].trigger.time, '05:00');
});
