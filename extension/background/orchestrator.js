// Run orchestrator: a persisted state machine, one short step at a time.
//
//   open -> preflight -> send -> await -> (next step: preflight) ... -> done
//
// Every step writes its result to storage before moving on, so a stopped service worker,
// a crashed tab or a late alarm never leaves a run in limbo. A step takes a 90 s lease
// (cursor.nextAt) first; if the worker dies mid-step the lease expires and the watchdog
// alarm resumes the run from the same phase. Before any send a sendIntent is saved, and a
// resume after that point checks the page for the message instead of sending again.

import { load, mutate, isActive, getRun } from './storage.js';
import { ADAPTER_FILES, PROVIDERS, providerForUrl, sameChatUrl, normalizeTargetUrl } from '../shared/providers.js';
import { renderPrompt } from '../core/prompt.js';
import { syncWatchdog, syncKeepAwake, updateBadge, notifyFinish } from './system.js';
import { applyResetSync } from './resync.js';

const LEASE_MS = 90000;
const SHORT_WAIT_MS = 20000;
const MAX_ATTEMPT_LOG = 30;

class RunError extends Error {
  constructor(code, retryable, detail) {
    super(detail || code);
    this.code = code;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- run records

export function makeRun(schedule, scheduledFor, manual, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    provider: schedule.target.provider,
    scheduledFor,
    createdAt: now,
    manual: !!manual,
    status: 'queued',
    reasonCode: '',
    attemptCount: 0,
    attempts: [],
    cursor: { phase: 'open', stepIndex: 0, sentSteps: 0, nextAt: now },
  };
}

export function finishedRun(schedule, scheduledFor, status, reasonCode, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    provider: schedule.target.provider,
    scheduledFor,
    createdAt: now,
    endedAt: now,
    manual: false,
    status,
    reasonCode,
    attemptCount: 0,
    attempts: [],
    cursor: { phase: 'done' },
  };
}

function pushAttempt(run, outcome, extra) {
  run.attemptCount = (run.attemptCount || 0) + 1;
  run.attempts.push({ at: Date.now(), outcome, ...(extra || {}) });
  if (run.attempts.length > MAX_ATTEMPT_LOG) run.attempts.splice(0, run.attempts.length - MAX_ATTEMPT_LOG);
}

async function patchRun(id, fn) {
  return mutate((data) => {
    const r = data.runs.find((x) => x.id === id);
    if (!r) return null;
    fn(r, data);
    return structuredClone(r);
  });
}

const go = (run, phase, extra) =>
  patchRun(run.id, (r) => {
    r.cursor = { ...r.cursor, ...(extra || {}), phase, nextAt: Date.now() };
  });

async function finish(run, status, reasonCode = '', cursorPatch) {
  const now = Date.now();
  let done = null;
  let settings = null;
  await mutate((data) => {
    const r = data.runs.find((x) => x.id === run.id);
    if (!r || !isActive(r)) return;
    if (cursorPatch) Object.assign(r.cursor, cursorPatch);
    if (status === 'failed') pushAttempt(r, reasonCode || 'FAILED');
    r.status = status;
    r.reasonCode = reasonCode;
    r.endedAt = now;
    r.cursor = { phase: 'done' };
    const s = data.schedules.find((x) => x.id === r.scheduleId);
    if (s) {
      s.lastRunAt = now;
      if (status === 'sent') s.runCount = (s.runCount || 0) + 1;
    }
    done = structuredClone(r);
    settings = data.settings;
  });
  await chrome.alarms.clear('run:' + run.id);
  if (done) await notifyFinish(done, settings);
  await syncWatchdog();
  await syncKeepAwake();
  await updateBadge();
}

export async function cancelRun(id) {
  const run = await getRun(id);
  if (run && isActive(run)) await finish(run, 'failed', 'CANCELLED');
}

// ---------------------------------------------------------------- tabs and page calls

async function findTab(url) {
  const tabs = await chrome.tabs.query({});
  const matches = tabs.filter((t) => t.url && sameChatUrl(t.url, url));
  return matches.find((t) => !t.discarded) || matches[0] || null;
}

async function waitForTab(tabId, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return false;
    }
    if (tab.status === 'complete') return true;
    await sleep(500);
  }
  return false;
}

async function ensureRunner(tabId) {
  const want = chrome.runtime.getManifest().version;
  const probe = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (globalThis.__PA_READY === true ? globalThis.__PA_VERSION : null),
  });
  if (probe && probe[0] && probe[0].result === want) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ADAPTER_FILES });
}

async function callRunner(tabId, method, arg) {
  if (tabId == null) throw new RunError('TAB_UNREACHABLE', true, 'no tab');
  try {
    await ensureRunner(tabId);
    const out = await chrome.scripting.executeScript({
      target: { tabId },
      func: (m, a) => globalThis.__PA.call(m, a),
      args: [method, arg == null ? null : arg],
    });
    const res = out && out[0] ? out[0].result : undefined;
    if (res === undefined || res === null) throw new RunError('RUNNER_ERROR', true, 'empty result');
    if (res.__error) throw new RunError('RUNNER_ERROR', true, res.__error);
    return res;
  } catch (e) {
    if (e instanceof RunError) throw e;
    throw new RunError('TAB_UNREACHABLE', true, String((e && e.message) || e));
  }
}

/** Opens (or reuses) the chat tab, calls one read-only runner method, and closes a tab it opened. */
async function withChatTab(url, method, arg) {
  const target = normalizeTargetUrl(url);
  if (!target.ok) return { ok: false, error: target.error };
  const provider = PROVIDERS[target.provider];
  if (!(await chrome.permissions.contains({ origins: provider.origins }))) {
    return { ok: false, error: 'Access to this site has not been approved yet.' };
  }
  let tab = await findTab(target.url);
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: target.url, active: false });
    created = true;
    await sleep(500);
  }
  try {
    if (!(await waitForTab(tab.id, 45000))) return { ok: false, error: 'The page did not finish loading.' };
    const result = await callRunner(tab.id, method, arg);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    if (created) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** "Check this page": looks for the message box, sends nothing. */
export const selfTestUrl = (url) => withChatTab(url, 'selfTest', {});

/** "Read reset time": looks for a usage-limit notice and reads the time from it, sends nothing. */
export const detectResetUrl = (url) => withChatTab(url, 'readReset', { waitMs: 8000 });

// ---------------------------------------------------------------- the pump

let pumping = false;
let pumpAgain = false;

/** Advances every due run until none is due within a few seconds. Safe to call at any time. */
export async function pump() {
  if (pumping) {
    pumpAgain = true;
    return;
  }
  pumping = true;
  try {
    do {
      pumpAgain = false;
      await drain();
    } while (pumpAgain);
  } finally {
    pumping = false;
  }
  await syncWatchdog();
  await updateBadge();
}

async function drain() {
  for (let guard = 0; guard < 100000; guard++) {
    const { runs } = await load();
    const active = runs.filter(isActive);
    if (!active.length) return;
    const now = Date.now();
    const due = active
      .filter((r) => (r.cursor?.nextAt ?? 0) <= now + 500)
      .sort((a, b) => a.cursor.nextAt - b.cursor.nextAt)[0];
    if (due) {
      await advance(due.id);
      continue;
    }
    const wait = Math.min(...active.map((r) => r.cursor.nextAt)) - now;
    if (wait > SHORT_WAIT_MS) return; // an alarm or the watchdog wakes us later
    await sleep(Math.max(50, wait));
  }
}

async function advance(id) {
  const now = Date.now();
  const run = await patchRun(id, (r) => {
    if (!isActive(r)) return;
    if (r.status === 'queued' || r.status === 'blocked') r.status = 'running';
    if (!r.startedAt) r.startedAt = now;
    r.cursor.nextAt = now + LEASE_MS;
  });
  if (!run || !isActive(run)) return;
  const { settings, schedules } = await load();
  const schedule = schedules.find((s) => s.id === run.scheduleId);
  if (!schedule) return finish(run, 'failed', 'SCHEDULE_DELETED');
  try {
    await step(run, schedule, settings);
  } catch (e) {
    await onError(run, schedule, e);
  }
}

function step(run, schedule, settings) {
  switch (run.cursor.phase) {
    case 'open':
      return phaseOpen(run, schedule, settings);
    case 'preflight':
      return phasePreflight(run, schedule);
    case 'send':
      return phaseSend(run, schedule);
    case 'await':
      return phaseAwait(run, schedule);
    default:
      return finish(run, 'failed', 'INTERNAL_ERROR');
  }
}

async function onError(run, schedule, e) {
  const code = e instanceof RunError ? e.code : 'INTERNAL_ERROR';
  const retryable = e instanceof RunError ? e.retryable : false;
  console.warn('[PromptAlarm] step failed:', code, e && e.message);
  const fresh = (await getRun(run.id)) || run;
  if (!isActive(fresh)) return;
  // Once a message was sent, never go back to sending: finish or continue with the next step.
  if (fresh.cursor.phase === 'await') return afterReplyFailure(fresh, schedule, code);
  if (retryable) return retryOrFail(fresh, schedule, code);
  return finish(fresh, 'failed', code);
}

// ---------------------------------------------------------------- phases

async function phaseOpen(run, schedule, settings) {
  if (settings.paused && !run.manual) return finish(run, 'skipped', 'PAUSED');
  const provider = providerForUrl(schedule.target.url);
  if (!provider) return finish(run, 'failed', 'UNSUPPORTED_SITE');
  if (!(await chrome.permissions.contains({ origins: provider.origins }))) {
    return finish(run, 'failed', 'ACCESS_REVOKED');
  }
  if (!run.cursor.windowEnd) {
    await patchRun(run.id, (r) => {
      r.cursor.windowEnd = Date.now() + schedule.retry.windowMin * 60000;
    });
  }

  let tab = await findTab(schedule.target.url);
  if (tab && (tab.discarded || run.cursor.reload)) {
    await chrome.tabs.reload(tab.id);
    await sleep(500);
  }
  if (!tab) {
    tab = await chrome.tabs.create({ url: schedule.target.url, active: false });
    await sleep(500);
  }
  if (!(await waitForTab(tab.id, 45000))) throw new RunError('OFFLINE', true);

  const info = await chrome.tabs.get(tab.id);
  const here = info.url ? providerForUrl(info.url) : null;
  if (!here || here.id !== provider.id) throw new RunError('SIGNED_OUT', false, 'redirected away from the chat');
  await go(run, 'preflight', { tabId: tab.id, reload: false });
}

async function phasePreflight(run, schedule) {
  const res = await callRunner(run.cursor.tabId, 'preflight', {
    overwriteDraft: schedule.overwriteDraft,
    waitMs: 20000,
  });
  switch (res.state) {
    case 'ready':
      return go(run, 'send', { baseline: res.counts, sendIntent: null });
    case 'signed-out':
      return finish(run, 'failed', 'SIGNED_OUT');
    case 'draft-present':
      return finish(run, 'failed', 'DRAFT_PRESENT');
    case 'limit-reached':
    case 'blocked-unknown':
      return retryOrFail(run, schedule, 'LIMIT_ACTIVE', res.resetAt);
    case 'composer-missing':
    case 'no-adapter':
      return composerMissing(run, schedule);
    default:
      throw new RunError('RUNNER_ERROR', true, 'preflight: ' + res.state);
  }
}

async function composerMissing(run, schedule) {
  if (!run.cursor.reloaded) return go(run, 'open', { reload: true, reloaded: true });
  return finish(run, 'failed', 'ADAPTER_OUTDATED');
}

const capOf = (schedule) => Math.min(schedule.maxMessagesPerRun, schedule.steps.length);

async function phaseSend(run, schedule) {
  const c = run.cursor;
  const stepDef = schedule.steps[c.stepIndex];
  const remaining = schedule.steps.length - c.stepIndex;
  if (!stepDef) return finish(run, 'sent', '');
  if (c.sentSteps >= capOf(schedule)) return finish(run, 'sent', remaining > 0 ? 'CAP_REACHED' : '');

  const text = renderPrompt(stepDef.text, {
    now: Date.now(),
    runNumber: (schedule.runCount || 0) + 1,
    tz: schedule.trigger.tz,
  });

  // A resume after a send was started: look at the page before sending anything again.
  if (c.sendIntent && c.sendIntent.stepIndex === c.stepIndex) {
    const chk = await callRunner(c.tabId, 'checkSent', { text, baseline: c.baseline });
    if (chk.sent) return afterSent(run, schedule);
  }

  await patchRun(run.id, (r) => {
    r.cursor.sendIntent = { stepIndex: r.cursor.stepIndex, nonce: crypto.randomUUID(), at: Date.now() };
  });
  const res = await callRunner(c.tabId, 'sendPrompt', {
    text,
    overwriteDraft: schedule.overwriteDraft,
    baseline: c.baseline,
  });
  if (res.ok) return afterSent(run, schedule);

  if (res.state === 'unverified') {
    await sleep(2500);
    const chk = await callRunner(c.tabId, 'checkSent', { text, baseline: c.baseline });
    if (chk.sent) return afterSent(run, schedule);
  }

  const clear = { sendIntent: null };
  switch (res.state) {
    case 'limit-reached':
    case 'blocked-unknown':
      return retryOrFail(run, schedule, 'LIMIT_ACTIVE', res.resetAt, clear);
    case 'draft-present':
      return finish(run, 'failed', 'DRAFT_PRESENT', clear);
    case 'composer-missing':
    case 'send-button-missing':
    case 'insert-failed':
    case 'no-adapter':
      await patchRun(run.id, (r) => {
        r.cursor.sendIntent = null;
      });
      return composerMissing(run, schedule);
    default:
      return retryOrFail(run, schedule, 'SEND_FAILED', undefined, clear);
  }
}

async function afterSent(run, schedule) {
  const c = run.cursor;
  const stepDef = schedule.steps[c.stepIndex];
  const hasMore = c.stepIndex + 1 < schedule.steps.length;
  const sentSteps = c.sentSteps + 1;
  const capped = hasMore && sentSteps >= capOf(schedule);
  await patchRun(run.id, (r) => {
    r.cursor.sentSteps = sentSteps;
    r.cursor.sendIntent = null;
    r.cursor.sentAt = Date.now();
    pushAttempt(r, 'sent');
  });
  const mustWait = (hasMore && !capped) || stepDef.waitForReply;
  if (!mustWait) return finish(run, 'sent', capped ? 'CAP_REACHED' : '');
  return go(run, 'await', { waitKey: `${run.id}:${c.stepIndex}`, sentSteps });
}

async function phaseAwait(run, schedule) {
  const c = run.cursor;
  const stepDef = schedule.steps[c.stepIndex];
  const res = await callRunner(c.tabId, 'waitForReply', {
    key: c.waitKey,
    baseline: c.baseline,
    sinceMs: c.sentAt,
    maxMs: SHORT_WAIT_MS,
    quietMs: 3000,
    noReplyMs: Math.min(60000, stepDef.timeoutSec * 1000),
  });
  switch (res.state) {
    case 'generating':
      if (Date.now() - c.sentAt > stepDef.timeoutSec * 1000) return replyDone(run, schedule, 'REPLY_TIMEOUT');
      return go(run, 'await', {});
    case 'done':
      return replyDone(run, schedule, '');
    case 'no-reply':
      return replyDone(run, schedule, 'NO_REPLY_DETECTED');
    case 'limit-reached':
      return replyBlocked(run, schedule, res.resetAt);
    default:
      return replyDone(run, schedule, 'REPLY_ERROR');
  }
}

function moreStepsAllowed(run, schedule) {
  return run.cursor.stepIndex + 1 < schedule.steps.length && run.cursor.sentSteps < capOf(schedule);
}

async function replyDone(run, schedule, warning) {
  if (moreStepsAllowed(run, schedule)) {
    return go(run, 'preflight', { stepIndex: run.cursor.stepIndex + 1, sendIntent: null, waitKey: null });
  }
  const hasMore = run.cursor.stepIndex + 1 < schedule.steps.length;
  return finish(run, 'sent', warning || (hasMore ? 'CAP_REACHED' : ''));
}

/** The limit appeared after a message was accepted. Remaining steps wait for the reset. */
async function replyBlocked(run, schedule, resetAt) {
  if (moreStepsAllowed(run, schedule)) {
    return retryOrFail(run, schedule, 'LIMIT_ACTIVE', resetAt, {
      stepIndex: run.cursor.stepIndex + 1,
      waitKey: null,
    });
  }
  return finish(run, 'sent', 'LIMIT_REACHED_MID_RUN');
}

async function afterReplyFailure(run, schedule, code) {
  if (moreStepsAllowed(run, schedule)) {
    return retryOrFail(run, schedule, code, undefined, { stepIndex: run.cursor.stepIndex + 1, waitKey: null });
  }
  return finish(run, 'sent', code);
}

/** Schedules the next attempt, or fails when the retry window is over. */
async function retryOrFail(run, schedule, code, resetAt, cursorPatch) {
  const now = Date.now();
  const policy = schedule.retry;
  if (code === 'LIMIT_ACTIVE' && resetAt) {
    await applyResetSync(schedule.id, resetAt, now).catch((e) => console.warn('[PromptAlarm] reset sync failed', e));
  }
  let windowEnd = run.cursor.windowEnd || now + policy.windowMin * 60000;
  let nextAt = now + policy.intervalMin * 60000;
  if (resetAt && resetAt > now && resetAt - now <= 24 * 3600000) {
    // A reset time read from the page is a hint, never a promise: keep checking at the normal
    // interval, but look again right after the reset, and keep going until shortly after it.
    nextAt = Math.min(nextAt, resetAt + 60000);
    windowEnd = Math.max(windowEnd, resetAt + 15 * 60000);
  }
  if (!policy.enabled || nextAt > windowEnd) return finish(run, 'failed', code, cursorPatch);

  await patchRun(run.id, (r) => {
    Object.assign(r.cursor, cursorPatch || {});
    pushAttempt(r, code, resetAt ? { resetAt } : undefined);
    r.status = 'blocked';
    r.reasonCode = code;
    Object.assign(r.cursor, { phase: 'open', nextAt, windowEnd, reload: false, sendIntent: null });
  });
  chrome.alarms.create('run:' + run.id, { when: nextAt });
  await syncWatchdog();
  await updateBadge();
}
