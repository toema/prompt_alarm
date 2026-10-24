// End-to-end tests: the real extension (test build) loaded in Chromium, driving a mock chat site.
// Run: npm run test:e2e   (builds dist/extension-test first)

import { createRequire } from 'node:module';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockChat } from '../mock-chat/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const extPath = join(here, '..', '..', 'dist', 'extension-test');
assert.ok(existsSync(join(extPath, 'manifest.json')), 'run `node scripts/build.mjs --test` first');

// Prefer the project's own node_modules (npm install); PLAYWRIGHT_DIR is an optional fallback location.
const projectRequire = createRequire(join(here, '..', '..', 'package.json'));
const load = (name) => {
  try {
    return projectRequire(name);
  } catch {
    return createRequire(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/')(name);
  }
};
const { chromium } = load('playwright');

let mock, BASE, ctx, extId, ctrl, profileDir;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 30000, interval = 250, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const api = (type, payload) => ctrl.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, ...p }), [type, payload || {}]);
const store = () => ctrl.evaluate(() => chrome.storage.local.get(null));
const setMock = (obj) => fetch(`${BASE}/__set`, { method: 'POST', body: JSON.stringify(obj) });
const mockLog = async () => (await fetch(`${BASE}/__log`)).json();
const messagesSent = async () => (await mockLog()).filter((e) => e.type === 'msg');
const url = (id, q = '') => `${BASE}/chat/${id}${q}`;

function scheduleInput(over = {}) {
  return {
    name: 'Test run',
    target: { url: url('t1') },
    trigger: { type: 'daily', time: '05:00', days: [0, 1, 2, 3, 4, 5, 6], tz: 'UTC' },
    steps: [{ text: 'Continue the project.', waitForReply: true }],
    retry: { enabled: true, intervalMin: 0.1, windowMin: 3 },
    graceMin: 120,
    maxMessagesPerRun: 1,
    overwriteDraft: false,
    ...over,
  };
}

async function saveSchedule(over) {
  const res = await api('schedule/save', { schedule: scheduleInput(over) });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.schedule;
}

const runsOf = async () => (await store()).runs || [];
const waitRun = async (pred, opts) => {
  try {
    return await until(async () => (await runsOf()).find(pred), { what: 'a matching run', ...opts });
  } catch (e) {
    e.message += '\nruns: ' + JSON.stringify(await runsOf(), null, 1).slice(0, 3000) + '\nlog: ' + JSON.stringify(await mockLog());
    throw e;
  }
};
const terminal = (r) => ['sent', 'failed', 'missed', 'skipped'].includes(r.status);

before(async () => {
  mock = await startMockChat(0);
  BASE = `http://127.0.0.1:${mock.port}`;
  profileDir = mkdtempSync(join(tmpdir(), 'pa-e2e-'));
  ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  extId = new URL(sw.url()).host;
  ctrl = await ctx.newPage();
  await ctrl.goto(`chrome-extension://${extId}/ui/options.html`);
});

after(async () => {
  await ctx?.close();
  await mock?.close();
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await fetch(`${BASE}/__reset`, { method: 'POST' });
  await ctrl.evaluate(async () => {
    await chrome.alarms.clearAll();
    await chrome.storage.local.clear();
  });
  for (const p of ctx.pages()) if (p !== ctrl) await p.close().catch(() => {});
  await sleep(300);
});

describe('sending', () => {
  it('sends a multi-line prompt and finishes when the reply completes', { timeout: 90000 }, async () => {
    // The mock page also has a sidebar link whose text reads like a limit notice; it must be ignored.
    const s = await saveSchedule({ steps: [{ text: 'Hello world\nSecond line', waitForReply: true }] });
    assert.equal((await api('schedule/runNow', { id: s.id })).ok, true);
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    assert.equal(run.reasonCode, '');
    const msgs = await messagesSent();
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text.replace(/\s+/g, ' '), 'Hello world Second line');
    assert.equal((await store()).schedules[0].runCount, 1);
    const log = await mockLog();
    assert.deepEqual(log.map((e) => e.type), ['msg', 'reply-done'], 'run finished only after the reply');
  });

  it('falls back to typing when the editor ignores synthetic paste', { timeout: 90000 }, async () => {
    await setMock({ nopaste: true });
    const s = await saveSchedule({ steps: [{ text: 'line one\nline two', waitForReply: false }] });
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    const msgs = await messagesSent();
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text.replace(/\s+/g, ' '), 'line one line two');
  });

  it('waits for a slowly loading conversation before sending', { timeout: 90000 }, async () => {
    const s = await saveSchedule({ target: { url: url('hydrate', '?seed=3&hydrate=1500') } });
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    assert.equal((await messagesSent()).length, 1);
  });

  it('a usage warning next to a working message box does not block the run', { timeout: 90000 }, async () => {
    await setMock({ warn: true });
    const s = await saveSchedule();
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    assert.equal((await messagesSent()).length, 1);
  });

  it('sends follow-up prompts only after the previous reply finishes', { timeout: 120000 }, async () => {
    await setMock({ replyMs: 2500 });
    const s = await saveSchedule({
      steps: [
        { text: 'part one', waitForReply: true },
        { text: 'part two', waitForReply: true },
      ],
      maxMessagesPerRun: 2,
    });
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 100000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    const log = await mockLog();
    assert.deepEqual(log.map((e) => e.type), ['msg', 'reply-done', 'msg', 'reply-done']);
    assert.deepEqual(log.filter((e) => e.type === 'msg').map((e) => e.text), ['part one', 'part two']);
  });

  it('the per-run message cap stops extra steps', { timeout: 90000 }, async () => {
    const s = await saveSchedule({
      steps: [{ text: 'first' }, { text: 'second' }],
      maxMessagesPerRun: 1,
    });
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'sent');
    assert.equal(run.reasonCode, 'CAP_REACHED');
    assert.deepEqual((await messagesSent()).map((e) => e.text), ['first']);
  });
});

describe('limits and retries', () => {
  it('retries until the limit resets, then sends exactly once', { timeout: 120000 }, async () => {
    await setMock({ limit: true });
    const s = await saveSchedule({ retry: { enabled: true, intervalMin: 0.1, windowMin: 5 } });
    await api('schedule/runNow', { id: s.id });

    const blocked = await waitRun((r) => r.status === 'blocked' && r.attemptCount >= 1, { timeout: 60000 });
    assert.equal(blocked.reasonCode, 'LIMIT_ACTIVE');
    assert.ok(blocked.attempts[0].resetAt > Date.now(), 'the reset time in the banner was read');
    assert.equal((await messagesSent()).length, 0, 'nothing is sent while limited');

    // our text must not be left behind in the message box
    const page = ctx.pages().find((p) => p.url().includes('/chat/t1'));
    assert.ok(page, 'the chat tab was opened');
    assert.equal((await page.innerText('#composer')).trim(), '');

    await setMock({ limit: false });
    const run = await waitRun(terminal, { timeout: 90000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    assert.ok(run.attempts.some((a) => a.outcome === 'LIMIT_ACTIVE'));
    assert.equal((await messagesSent()).length, 1, 'exactly one message');
  });

  it('fails with a clear reason when retries are off', { timeout: 90000 }, async () => {
    await setMock({ limit: true });
    const s = await saveSchedule({ retry: { enabled: false, intervalMin: 10, windowMin: 0 } });
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'failed');
    assert.equal(run.reasonCode, 'LIMIT_ACTIVE');
    assert.equal((await messagesSent()).length, 0);
  });

  it('a waiting run can be cancelled', { timeout: 90000 }, async () => {
    await setMock({ limit: true });
    const s = await saveSchedule({ retry: { enabled: true, intervalMin: 5, windowMin: 60 } });
    await api('schedule/runNow', { id: s.id });
    const blocked = await waitRun((r) => r.status === 'blocked', { timeout: 60000 });
    await api('run/cancel', { id: blocked.id });
    const run = (await runsOf()).find((r) => r.id === blocked.id);
    assert.equal(run.status, 'failed');
    assert.equal(run.reasonCode, 'CANCELLED');
    const alarms = await ctrl.evaluate(() => chrome.alarms.getAll());
    assert.equal(alarms.some((a) => a.name === 'run:' + blocked.id), false);
  });
});

describe('safety', () => {
  it('stops when the page redirects to a sign-in page', { timeout: 90000 }, async () => {
    await setMock({ signedOut: true });
    const s = await saveSchedule();
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'failed');
    assert.equal(run.reasonCode, 'SIGNED_OUT');
    assert.equal((await messagesSent()).length, 0);
  });

  it('never overwrites the person’s unsent draft by default', { timeout: 90000 }, async () => {
    const page = await ctx.newPage();
    await page.goto(url('t1'));
    await page.click('#composer');
    await page.keyboard.type('my own unsent thought');
    const s = await saveSchedule();
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'failed');
    assert.equal(run.reasonCode, 'DRAFT_PRESENT');
    assert.equal((await messagesSent()).length, 0);
    assert.equal((await page.innerText('#composer')).trim(), 'my own unsent thought');
  });

  it('replaces the draft only when the schedule allows it', { timeout: 90000 }, async () => {
    const page = await ctx.newPage();
    await page.goto(url('t1'));
    await page.click('#composer');
    await page.keyboard.type('old draft');
    const s = await saveSchedule({ overwriteDraft: true });
    await api('schedule/runNow', { id: s.id });
    const run = await waitRun(terminal, { timeout: 60000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    const msgs = await messagesSent();
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text, 'Continue the project.');
  });

  it('a resumed send checks the page and does not send twice', { timeout: 90000 }, async () => {
    const s = await saveSchedule({ target: { url: url('resume') }, steps: [{ text: 'resume test', waitForReply: true }] });
    // Simulate: the message was sent, then the service worker died before recording it.
    const page = await ctx.newPage();
    await page.goto(url('resume'));
    await page.click('#composer');
    await page.keyboard.type('resume test');
    await page.click('#send');
    await until(async () => (await messagesSent()).length === 1, { what: 'the first send' });

    const tabId = await ctrl.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(u))?.id, url('resume'));
    assert.ok(tabId, 'found the tab');
    const now = Date.now();
    await ctrl.evaluate(async ([sid, tid, t]) => {
      const { runs = [] } = await chrome.storage.local.get('runs');
      runs.unshift({
        id: 'resume-run', scheduleId: sid, scheduleName: 'Test run', provider: 'mock', scheduledFor: t, createdAt: t,
        startedAt: t, manual: true, status: 'running', reasonCode: '', attemptCount: 0, attempts: [],
        cursor: {
          phase: 'send', stepIndex: 0, sentSteps: 0, nextAt: t - 1, tabId: tid, windowEnd: t + 3600000,
          baseline: { user: 0, assistant: 0, assistantLen: 0 },
          sendIntent: { stepIndex: 0, nonce: 'x', at: t },
        },
      });
      await chrome.storage.local.set({ runs });
    }, [s.id, tabId, now]);

    await api('reconcile');
    const run = await waitRun((r) => r.id === 'resume-run' && terminal(r), { timeout: 60000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    assert.equal((await messagesSent()).length, 1, 'still exactly one message');
  });
});

describe('schedules, catch-up and pause', () => {
  const dueSchedule = (minutesAgo, over = {}) => {
    const t = new Date(Date.now() - minutesAgo * 60000);
    const hh = String(t.getUTCHours()).padStart(2, '0');
    const mm = String(t.getUTCMinutes()).padStart(2, '0');
    return {
      id: 'due-' + minutesAgo,
      name: 'Nightly',
      enabled: true,
      target: { provider: 'mock', url: url('t1') },
      trigger: { type: 'daily', time: `${hh}:${mm}`, days: [0, 1, 2, 3, 4, 5, 6], tz: 'UTC' },
      steps: [{ id: 's1', text: 'nightly prompt', waitForReply: false, timeoutSec: 600 }],
      retry: { enabled: false, intervalMin: 10, windowMin: 0 },
      graceMin: 120,
      maxMessagesPerRun: 1,
      overwriteDraft: false,
      createdAt: Date.now() - 3 * 86400000,
      handledUpTo: Date.now() - 2 * 86400000,
      runCount: 0,
      revision: 1,
      ...over,
    };
  };
  const seed = (schedule, settings) =>
    ctrl.evaluate(async ([s, st]) => {
      await chrome.storage.local.set({ schedules: [s], ...(st ? { settings: st } : {}) });
    }, [schedule, settings || null]);

  it('catches up an occurrence the browser missed, within the grace period', { timeout: 90000 }, async () => {
    await seed(dueSchedule(10));
    await api('reconcile');
    const runs = await until(async () => {
      const r = await runsOf();
      return r.length >= 2 && r.every(terminal) ? r : null;
    }, { timeout: 60000, what: 'catch-up runs' });
    assert.equal(runs.filter((r) => r.status === 'sent').length, 1, JSON.stringify(runs.map((r) => r.status)));
    assert.equal(runs.filter((r) => r.status === 'missed').length, 1, 'the older occurrence is recorded as missed');
    assert.equal((await messagesSent()).length, 1);
  });

  it('records a missed run and sends nothing once the grace period has passed', { timeout: 60000 }, async () => {
    await seed(dueSchedule(180));
    await api('reconcile');
    const runs = await until(async () => {
      const r = await runsOf();
      return r.length >= 1 ? r : null;
    });
    await sleep(2000);
    const all = await runsOf();
    assert.ok(all.every((r) => r.status === 'missed'), JSON.stringify(all.map((r) => r.status)));
    assert.equal((await messagesSent()).length, 0);
    assert.equal(all[0].reasonCode, 'MISSED_WINDOW');
  });

  it('pause-all skips scheduled runs, while Run now still works', { timeout: 90000 }, async () => {
    await seed(dueSchedule(10), { paused: true });
    await api('reconcile');
    await until(async () => (await runsOf()).length >= 1, { what: 'skipped runs' });
    const skipped = await runsOf();
    assert.ok(skipped.every((r) => r.status === 'skipped' && r.reasonCode === 'PAUSED'));
    assert.equal((await messagesSent()).length, 0);

    await api('schedule/runNow', { id: 'due-10' });
    const run = await waitRun((r) => r.manual && terminal(r), { timeout: 60000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    assert.equal((await messagesSent()).length, 1);
  });

  it('a real alarm starts the scheduled run on time', { timeout: 150000 }, async () => {
    const soon = new Date(Date.now() + 70000);
    const hh = String(soon.getUTCHours()).padStart(2, '0');
    const mm = String(soon.getUTCMinutes()).padStart(2, '0');
    const s = await saveSchedule({
      trigger: { type: 'daily', time: `${hh}:${mm}`, days: [0, 1, 2, 3, 4, 5, 6], tz: 'UTC' },
      steps: [{ text: 'alarm prompt', waitForReply: false }],
    });
    const alarms = await ctrl.evaluate(() => chrome.alarms.getAll());
    assert.ok(alarms.some((a) => a.name === 'sched:' + s.id), 'an alarm was created for the schedule');
    const run = await waitRun((r) => !r.manual && terminal(r), { timeout: 130000 });
    assert.equal(run.status, 'sent', JSON.stringify(run));
    assert.deepEqual((await messagesSent()).map((e) => e.text), ['alarm prompt']);
  });
});

describe('page check and interface', () => {
  it('"Check this page" finds the message box and reports sign-in pages', { timeout: 90000 }, async () => {
    const ok = await api('target/selfTest', { url: url('check') });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.result.adapter, 'mock');
    assert.equal(ok.result.composerFound, true);
    assert.equal(ok.result.signedOut, false);
    await setMock({ signedOut: true });
    const out = await api('target/selfTest', { url: url('check2') });
    assert.equal(out.result.signedOut, true);
    assert.equal((await messagesSent()).length, 0, 'the check sends nothing');
  });

  it('rejects unsupported links and malformed schedules', async () => {
    const bad = await api('schedule/save', { schedule: scheduleInput({ target: { url: 'https://example.com/x' } }) });
    assert.equal(bad.ok, false);
    assert.match(bad.errors[0], /Unsupported site/);
    const none = await api('schedule/save', { schedule: scheduleInput({ steps: [{ text: '  ' }] }) });
    assert.equal(none.ok, false);
    assert.equal((await store()).schedules?.length ?? 0, 0);
  });

  it('the dashboard creates a schedule through the form', { timeout: 60000 }, async () => {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/ui/options.html`);
    await page.click('#new');
    await page.fill('#f-name', 'From the form');
    await page.fill('#f-url', url('form'));
    await page.fill('#steps textarea', 'Continue from where we stopped.');
    await page.click('#editor-save');
    await page.waitForSelector('#checklist[open]', { timeout: 15000 });
    await page.click('#cl-done');
    await page.waitForSelector('text=From the form');
    const { schedules } = await store();
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].steps[0].text, 'Continue from where we stopped.');
    assert.equal(schedules[0].trigger.type, 'once');
    await page.close();
  });

  it('the popup renders the next run', async () => {
    await saveSchedule({ name: 'Popup check' });
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/ui/popup.html`);
    await page.waitForSelector('text=Popup check');
    assert.match(await page.innerText('.night'), /Next run: Popup check/);
    await page.close();
  });

  it('export then import round-trips schedules', { timeout: 60000 }, async () => {
    await saveSchedule({ name: 'Round trip', steps: [{ text: 'a\nb' }] });
    const exp = await api('data/export');
    assert.equal(exp.ok, true);
    await ctrl.evaluate(() => chrome.storage.local.set({ schedules: [] }));
    const imp = await api('data/import', { file: exp.data });
    assert.equal(imp.ok, true, JSON.stringify(imp));
    assert.equal(imp.imported, 1);
    const { schedules } = await store();
    assert.equal(schedules[0].name, 'Round trip');
    assert.equal(schedules[0].steps[0].text, 'a\nb');
    const junk = await api('data/import', { file: { hello: 'world' } });
    assert.equal(junk.ok, false);
  });
});

describe('managing schedules', () => {
  it('editing keeps the schedule and re-arms it; toggle, duplicate and delete work', { timeout: 60000 }, async () => {
    const s = await saveSchedule({ name: 'Before' });
    const edited = await api('schedule/save', {
      schedule: { ...scheduleInput({ name: 'After', trigger: { type: 'daily', time: '06:30', days: [1, 3, 5], tz: 'UTC' } }), id: s.id },
    });
    assert.equal(edited.ok, true, JSON.stringify(edited));
    assert.equal(edited.schedule.id, s.id);
    assert.equal(edited.schedule.name, 'After');
    assert.equal(edited.schedule.revision, 2);
    assert.equal((await store()).schedules.length, 1);

    const alarmName = 'sched:' + s.id;
    const hasAlarm = async () => (await ctrl.evaluate(() => chrome.alarms.getAll())).some((a) => a.name === alarmName);
    assert.equal(await hasAlarm(), true);
    assert.equal((await api('schedule/toggle', { id: s.id, enabled: false })).ok, true);
    assert.equal(await hasAlarm(), false, 'turning a schedule off removes its alarm');
    assert.equal((await api('schedule/toggle', { id: s.id, enabled: true })).ok, true);
    assert.equal(await hasAlarm(), true);

    const dup = await api('schedule/duplicate', { id: s.id });
    assert.equal(dup.ok, true);
    const { schedules } = await store();
    const copy = schedules.find((x) => x.id === dup.id);
    assert.equal(copy.name, 'After (copy)');
    assert.equal(copy.enabled, false, 'a copy starts switched off');

    await api('schedule/delete', { id: s.id });
    assert.equal(await hasAlarm(), false, 'deleting a schedule removes its alarm');
    assert.equal((await store()).schedules.length, 1);
  });

  it('a finished one-time schedule cannot be switched on again without a new time', { timeout: 60000 }, async () => {
    await ctrl.evaluate(async () => {
      await chrome.storage.local.set({
        schedules: [{
          id: 'old-once', name: 'Old once', enabled: false,
          target: { provider: 'mock', url: 'http://127.0.0.1:1/chat/x' },
          trigger: { type: 'once', at: '2020-01-01T05:00', tz: 'UTC' },
          steps: [{ id: 's', text: 'x', waitForReply: false, timeoutSec: 600 }],
          retry: { enabled: false, intervalMin: 10, windowMin: 0 }, graceMin: 120, maxMessagesPerRun: 1,
          overwriteDraft: false, createdAt: 1, handledUpTo: 1, runCount: 1, revision: 1,
        }],
      });
    });
    const res = await api('schedule/toggle', { id: 'old-once', enabled: true });
    assert.equal(res.ok, false);
    assert.match(res.error, /no upcoming time/i);
    assert.equal((await store()).schedules[0].enabled, false);
  });

  it('a one-time schedule turns itself off after it fires', { timeout: 60000 }, async () => {
    const past = new Date(Date.now() - 5 * 60000);
    const p = (n) => String(n).padStart(2, '0');
    const at = `${past.getUTCFullYear()}-${p(past.getUTCMonth() + 1)}-${p(past.getUTCDate())}T${p(past.getUTCHours())}:${p(past.getUTCMinutes())}`;
    await ctrl.evaluate(async ([when]) => {
      await chrome.storage.local.set({
        schedules: [{
          id: 'once-due', name: 'Once due', enabled: true,
          target: { provider: 'mock', url: 'http://127.0.0.1/chat/none' },
          trigger: { type: 'once', at: when, tz: 'UTC' },
          steps: [{ id: 's', text: 'x', waitForReply: false, timeoutSec: 600 }],
          retry: { enabled: false, intervalMin: 10, windowMin: 0 }, graceMin: 0, maxMessagesPerRun: 1,
          overwriteDraft: false, createdAt: Date.now() - 600000, handledUpTo: Date.now() - 600000, runCount: 0, revision: 1,
        }],
      });
    }, [at]);
    await api('reconcile');
    const { schedules, runs } = await store();
    assert.equal(schedules[0].enabled, false);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'missed', 'grace was 0, so it is recorded as missed');
  });

  it('the dashboard opens the editor with a link passed from the popup', { timeout: 60000 }, async () => {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/ui/options.html#new=${encodeURIComponent(url('from-popup'))}`);
    await page.waitForSelector('#editor[open]');
    assert.equal(await page.inputValue('#f-url'), url('from-popup'));
    assert.match(await page.innerText('#f-url-hint'), /Detected: Mock chat/);
    await page.close();
  });
});
