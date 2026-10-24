import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedToMs, nextOccurrenceAfter, partsInTz, toLocalInput, isValidTimeZone, formatCountdown } from '../../extension/core/time.js';

const iso = (ms) => new Date(ms).toISOString();

test('zonedToMs: ordinary time', () => {
  assert.equal(iso(zonedToMs(2024, 6, 1, 5, 0, 'America/New_York')), '2024-06-01T09:00:00.000Z');
  assert.equal(iso(zonedToMs(2024, 1, 15, 5, 0, 'Europe/Berlin')), '2024-01-15T04:00:00.000Z');
  assert.equal(iso(zonedToMs(2024, 1, 15, 5, 0, 'UTC')), '2024-01-15T05:00:00.000Z');
});

test('zonedToMs: nonexistent local time shifts forward (spring forward)', () => {
  // New York 2024-03-10 02:30 does not exist; clocks jump 02:00 -> 03:00
  assert.equal(iso(zonedToMs(2024, 3, 10, 2, 30, 'America/New_York')), '2024-03-10T07:30:00.000Z');
  // Berlin 2024-03-31 02:30 does not exist
  assert.equal(iso(zonedToMs(2024, 3, 31, 2, 30, 'Europe/Berlin')), '2024-03-31T01:30:00.000Z');
});

test('zonedToMs: ambiguous local time uses the first occurrence (fall back)', () => {
  // New York 2024-11-03 01:30 happens twice; first is EDT (UTC-4)
  assert.equal(iso(zonedToMs(2024, 11, 3, 1, 30, 'America/New_York')), '2024-11-03T05:30:00.000Z');
});

test('daily trigger keeps the local time across DST', () => {
  const trigger = { type: 'daily', time: '05:00', days: [0, 1, 2, 3, 4, 5, 6], tz: 'America/New_York' };
  const before = zonedToMs(2024, 3, 9, 5, 0, 'America/New_York'); // EST
  const next = nextOccurrenceAfter(trigger, before);
  const p = partsInTz(next, 'America/New_York');
  assert.deepEqual([p.y, p.mo, p.d, p.h, p.mi], [2024, 3, 10, 5, 0]);
  assert.equal(next - before, 23 * 3600000); // the day was 23 hours long
});

test('daily trigger honors selected weekdays', () => {
  // Weekdays only; start on a Friday evening, next must be Monday
  const trigger = { type: 'daily', time: '05:00', days: [1, 2, 3, 4, 5], tz: 'UTC' };
  const fri = Date.UTC(2024, 5, 7, 20, 0); // 2024-06-07 is a Friday
  const next = nextOccurrenceAfter(trigger, fri);
  assert.equal(iso(next), '2024-06-10T05:00:00.000Z');
});

test('daily trigger: a single weekday finds next week', () => {
  const trigger = { type: 'daily', time: '09:15', days: [3], tz: 'UTC' }; // Wednesdays
  const wed = Date.UTC(2024, 5, 5, 10, 0); // Wed 2024-06-05 after 09:15
  assert.equal(iso(nextOccurrenceAfter(trigger, wed)), '2024-06-12T09:15:00.000Z');
});

test('nextOccurrenceAfter is strictly after the given instant', () => {
  const trigger = { type: 'daily', time: '05:00', days: [0, 1, 2, 3, 4, 5, 6], tz: 'UTC' };
  const exact = Date.UTC(2024, 5, 7, 5, 0);
  assert.equal(iso(nextOccurrenceAfter(trigger, exact)), '2024-06-08T05:00:00.000Z');
});

test('once trigger fires once, then never', () => {
  const trigger = { type: 'once', at: '2024-06-07T05:00', tz: 'Europe/Berlin' };
  assert.equal(iso(nextOccurrenceAfter(trigger, Date.UTC(2024, 5, 1))), '2024-06-07T03:00:00.000Z');
  assert.equal(nextOccurrenceAfter(trigger, Date.UTC(2024, 5, 8)), null);
});

test('invalid triggers return null instead of throwing', () => {
  assert.equal(nextOccurrenceAfter(null, 0), null);
  assert.equal(nextOccurrenceAfter({ type: 'daily', time: '25:00', days: [1], tz: 'UTC' }, 0), null);
  assert.equal(nextOccurrenceAfter({ type: 'daily', time: '05:00', days: [1], tz: 'Mars/Base' }, 0), null);
  assert.equal(nextOccurrenceAfter({ type: 'sometimes', tz: 'UTC' }, 0), null);
});

test('helpers', () => {
  assert.equal(isValidTimeZone('Europe/Berlin'), true);
  assert.equal(isValidTimeZone('Nope/Nope'), false);
  assert.equal(toLocalInput(Date.UTC(2024, 5, 1, 9, 5), 'America/New_York'), '2024-06-01T05:05');
  const now = 1_000_000;
  assert.equal(formatCountdown(now + 30_000, now), 'in under a minute');
  assert.equal(formatCountdown(now + 5 * 3600000 + 12 * 60000, now), 'in 5 h 12 min');
  assert.equal(formatCountdown(now - 1, now), 'now');
});
