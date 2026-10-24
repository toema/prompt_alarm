import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSchedule } from '../../extension/core/validate.js';
import { renderPrompt } from '../../extension/core/prompt.js';

const NOW = Date.UTC(2024, 5, 1, 12, 0);
const base = () => ({
  name: ' Night run ',
  target: { url: 'https://claude.ai/chat/abc#frag' },
  trigger: { type: 'daily', time: '05:00', days: [1, 2, 3], tz: 'Europe/Berlin' },
  steps: [{ text: ' Continue from where we stopped. ' }],
});

test('accepts a valid schedule and normalizes it', () => {
  const r = validateSchedule(base(), { now: NOW });
  assert.equal(r.ok, true, r.errors.join(','));
  assert.equal(r.value.name, 'Night run');
  assert.equal(r.value.target.url, 'https://claude.ai/chat/abc');
  assert.equal(r.value.target.provider, 'claude');
  assert.equal(r.value.steps[0].text, 'Continue from where we stopped.');
  assert.equal(r.value.retry.intervalMin, 10);
  assert.equal(r.value.retry.windowMin, 360);
  assert.equal(r.value.graceMin, 120);
  assert.equal(r.value.maxMessagesPerRun, 1);
  assert.equal(r.value.overwriteDraft, false);
});

test('drops unknown fields', () => {
  const r = validateSchedule({ ...base(), evil: 'x', handledUpTo: 5 }, { now: NOW });
  assert.equal('evil' in r.value, false);
  assert.equal('handledUpTo' in r.value, false);
});

test('rejects unsupported and insecure links', () => {
  assert.equal(validateSchedule({ ...base(), target: { url: 'https://example.com/x' } }, { now: NOW }).ok, false);
  assert.equal(validateSchedule({ ...base(), target: { url: 'http://claude.ai/chat/1' } }, { now: NOW }).ok, false);
  assert.equal(validateSchedule({ ...base(), target: { url: 'not a url' } }, { now: NOW }).ok, false);
  assert.equal(validateSchedule({ ...base(), target: { url: 'https://claude.ai.evil.com/chat/1' } }, { now: NOW }).ok, false);
});

test('requires a prompt, a weekday and a future once-time', () => {
  assert.equal(validateSchedule({ ...base(), steps: [{ text: '   ' }] }, { now: NOW }).ok, false);
  const noDays = { ...base(), trigger: { type: 'daily', time: '05:00', days: [], tz: 'UTC' } };
  assert.equal(validateSchedule(noDays, { now: NOW }).ok, false);
  const past = { ...base(), trigger: { type: 'once', at: '2024-05-01T05:00', tz: 'UTC' } };
  assert.equal(validateSchedule(past, { now: NOW }).ok, false);
  assert.equal(validateSchedule(past, { now: NOW, isNew: false }).ok, true);
  const future = { ...base(), trigger: { type: 'once', at: '2024-06-02T05:00', tz: 'UTC' } };
  assert.equal(validateSchedule(future, { now: NOW }).ok, true);
});

test('bounds on retry, grace, cap and prompt size', () => {
  assert.equal(validateSchedule({ ...base(), retry: { intervalMin: 0 } }, { now: NOW }).ok, false);
  assert.equal(validateSchedule({ ...base(), retry: { intervalMin: 5, windowMin: 5000 } }, { now: NOW }).ok, false);
  assert.equal(validateSchedule({ ...base(), graceMin: 99999 }, { now: NOW }).ok, false);
  assert.equal(validateSchedule({ ...base(), maxMessagesPerRun: 50 }, { now: NOW }).ok, false);
  assert.equal(validateSchedule({ ...base(), steps: [{ text: 'x'.repeat(20001) }] }, { now: NOW }).ok, false);
  assert.equal(validateSchedule({ ...base(), steps: Array.from({ length: 11 }, () => ({ text: 'a' })) }, { now: NOW }).ok, false);
});

test('renderPrompt fills known variables only', () => {
  const now = Date.UTC(2024, 5, 7, 3, 4);
  const out = renderPrompt('Run {{runNumber}} on {{date}} at {{time}} {{unknown}}', { now, runNumber: 3, tz: 'UTC' });
  assert.equal(out, 'Run 3 on 2024-06-07 at 03:04 {{unknown}}');
  assert.equal(renderPrompt('{{ date }}', { now, tz: 'Pacific/Auckland' }), '2024-06-07');
});
