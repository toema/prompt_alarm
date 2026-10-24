import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { PROVIDERS, providerForUrl, normalizeTargetUrl, sameChatUrl } from '../../extension/shared/providers.js';

const ctx = {};
vm.createContext(ctx);
const load = (p) => vm.runInContext(readFileSync(new URL(p, import.meta.url), 'utf8'), ctx);
load('../../extension/content/sdk.js');
const SDK = ctx.__PA_SDK;

// "now" = 2024-06-07 03:00 local time of this machine
const at = (h, m = 0, dayOffset = 0) => {
  const d = new Date(2024, 5, 7 + dayOffset, h, m, 0, 0);
  return d.getTime();
};
const NOW = at(3, 0);

test('parseResetTime: clock times', () => {
  assert.equal(SDK.parseResetTime('Your limit will reset at 5:00 AM.', NOW), at(5, 0));
  assert.equal(SDK.parseResetTime('Responses will use another model until your limit resets after 8:19 PM.', NOW), at(20, 19));
  assert.equal(SDK.parseResetTime('Try again at 17:30', NOW), at(17, 30));
  assert.equal(SDK.parseResetTime('Come back after 5 am', NOW), at(5, 0));
});

test('parseResetTime: "resets" without "at", and an explicit time zone', () => {
  assert.equal(SDK.parseResetTime("You've hit your limit \u00b7 resets 5am", NOW), at(5, 0));
  assert.equal(SDK.parseResetTime('Limit reached. Resets 5:30 AM', NOW), at(5, 30));
  // 5am in Cairo is 2am UTC (summer) or 3am UTC (winter); compare against Intl itself
  const cairo = SDK.parseResetTime('resets 5am (Africa/Cairo)', Date.UTC(2024, 5, 7, 0, 0));
  assert.equal(cairo, Date.UTC(2024, 5, 7, 2, 0));
  assert.equal(SDK.parseResetTime('resets at 9pm UTC', Date.UTC(2024, 5, 7, 0, 0)), Date.UTC(2024, 5, 7, 21, 0));
  // not a zone: ignored, falls back to the browser zone
  assert.equal(SDK.parseResetTime('Yes/No: resets at 5:00 AM', NOW), at(5, 0));
});

test('parseResetTime: a time already passed today means tomorrow', () => {
  assert.equal(SDK.parseResetTime('Limit resets at 2:00 AM', NOW), at(2, 0, 1));
});

test('parseResetTime: relative durations', () => {
  assert.equal(SDK.parseResetTime('Try again in 2 hours', NOW), NOW + 2 * 3600000);
  assert.equal(SDK.parseResetTime('Try again in about 3 hours and 15 minutes', NOW), NOW + 3 * 3600000 + 15 * 60000);
  assert.equal(SDK.parseResetTime('resets in 45 min', NOW), NOW + 45 * 60000);
  assert.equal(SDK.parseResetTime('in 1.5 hours', NOW), NOW + 90 * 60000);
});

test('parseResetTime: ignores text without a usable time', () => {
  assert.equal(SDK.parseResetTime('You have reached your limit.', NOW), null);
  assert.equal(SDK.parseResetTime('Limit of 40 messages at 3 per hour', NOW), null);
  assert.equal(SDK.parseResetTime('', NOW), null);
  assert.equal(SDK.parseResetTime('Try again in 99 hours', NOW), null);
});

test('limit patterns match real-sounding notices', () => {
  for (const t of [
    "You've reached your usage limit.",
    'Your limit will reset at 5:00 AM',
    "You've hit the free plan limit for GPT-5. Responses will use another model until your limit resets after 5:36 PM.",
    'You are out of free messages until tomorrow',
    'Too many requests. Try again later.',
    "You've reached your daily limit",
  ]) {
    assert.equal(SDK.matchesLimit(t), true, t);
  }
});

test('limit patterns do not match ordinary text', () => {
  for (const t of ['Ask me anything', 'Write your prompt to Claude', 'How do I reset my password?', 'Speed limit signs are round']) {
    assert.equal(SDK.matchesLimit(t), false, t);
  }
});

test('sameText ignores whitespace differences', () => {
  assert.equal(SDK.sameText('a  b\n c', 'a b c'), true);
  assert.equal(SDK.sameText('a b', 'a c'), false);
});

test('every adapter host list matches the provider list', () => {
  for (const f of readdirSync(new URL('../../extension/content/adapters/', import.meta.url))) {
    load(`../../extension/content/adapters/${f}`);
  }
  assert.equal(ctx.__PA_ADAPTERS.length, 3);
  for (const a of ctx.__PA_ADAPTERS) {
    assert.deepEqual([...a.hosts].sort(), [...PROVIDERS[a.id].hosts].sort(), a.id);
    for (const m of ['getComposer', 'getSendButton', 'isGenerating', 'userMessages', 'assistantMessages', 'isSignedOut']) {
      assert.equal(typeof a[m], 'function', `${a.id}.${m}`);
    }
  }
});

test('providers: URL handling', () => {
  assert.equal(providerForUrl('https://chatgpt.com/c/123').id, 'chatgpt');
  assert.equal(providerForUrl('https://chat.openai.com/c/123').id, 'chatgpt');
  assert.equal(providerForUrl('https://gemini.google.com/app/abc').id, 'gemini');
  assert.equal(providerForUrl('https://notclaude.ai/chat'), null);
  assert.equal(normalizeTargetUrl('https://claude.ai/new').ok, true);
  assert.equal(normalizeTargetUrl('https://claude.ai/chat/x?y=1#z').url, 'https://claude.ai/chat/x?y=1');
  assert.equal(sameChatUrl('https://claude.ai/chat/x/', 'https://claude.ai/chat/x?utm=1'), true);
  assert.equal(sameChatUrl('https://claude.ai/chat/x', 'https://claude.ai/chat/y'), false);
});
