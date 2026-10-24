// PromptAlarm runner. Classic script injected after the SDK and the adapters.
// The service worker calls its methods in short steps (each returns within ~25 s) and keeps
// all run state itself, so this script holds no state that matters if the page reloads.
(function (root) {
  'use strict';
  const S = root.__PA_SDK;
  if (!S) return;

  const VERSION =
    (root.chrome && root.chrome.runtime && root.chrome.runtime.getManifest && root.chrome.runtime.getManifest().version) ||
    '0';

  function adapter() {
    return (root.__PA_ADAPTERS || []).find((a) => a.matches(location.hostname)) || null;
  }

  function snapshot(a) {
    const users = a.userMessages();
    const assistants = a.assistantMessages();
    const last = assistants.length ? assistants[assistants.length - 1] : null;
    return {
      user: users.length,
      assistant: assistants.length,
      assistantLen: last ? (last.textContent || '').length : 0,
    };
  }

  async function stableCounts(a, maxMs) {
    const end = Date.now() + maxMs;
    let prev = JSON.stringify(snapshot(a));
    let since = Date.now();
    while (Date.now() < end) {
      await S.sleep(300);
      const cur = JSON.stringify(snapshot(a));
      if (cur !== prev) {
        prev = cur;
        since = Date.now();
      } else if (Date.now() - since >= 1200) break;
    }
  }

  function inspect(a, overwriteDraft) {
    if (a.isSignedOut()) return { state: 'signed-out' };
    const composer = a.getComposer();
    const banner = S.findLimitBanner(a);
    if (!composer || S.isDisabled(composer)) {
      if (banner) return { state: 'limit-reached', resetAt: banner.resetAt, limitText: banner.text };
      return { state: composer ? 'blocked-unknown' : 'composer-missing' };
    }
    if (S.norm(S.readText(composer)) !== '' && !overwriteDraft) return { state: 'draft-present' };
    // A limit notice next to a usable box can be a warning ("N messages left"), so try anyway.
    return { state: 'ready', limitHint: banner ? banner.text : undefined, resetAt: banner ? banner.resetAt : undefined };
  }

  async function preflight(arg) {
    const a = adapter();
    if (!a) return { state: 'no-adapter' };
    const end = Date.now() + (arg.waitMs || 15000);
    let r;
    for (;;) {
      r = inspect(a, arg.overwriteDraft);
      if (r.state !== 'composer-missing' || Date.now() >= end) break;
      await S.sleep(500);
    }
    if (r.state === 'ready') {
      await stableCounts(a, 8000);
      r.counts = snapshot(a);
    }
    return r;
  }

  function verifySent(a, text, baseline) {
    const snap = snapshot(a);
    const grew = !!baseline && snap.user > baseline.user;
    const composer = a.getComposer();
    if (composer) {
      const remaining = S.norm(S.readText(composer));
      const cleared = remaining === '' || !remaining.includes(S.norm(text).slice(0, 30));
      return grew || cleared;
    }
    return grew;
  }

  async function dropOurDraft(a, text) {
    const c = a.getComposer();
    if (c && S.norm(S.readText(c)).includes(S.norm(text).slice(0, 30))) await S.clearComposer(c);
  }

  async function sendPrompt(arg) {
    const a = adapter();
    if (!a) return { ok: false, state: 'no-adapter' };
    const { text, overwriteDraft, baseline } = arg;

    const composer = a.getComposer();
    if (!composer || S.isDisabled(composer)) {
      const banner = S.findLimitBanner(a);
      if (banner) return { ok: false, state: 'limit-reached', resetAt: banner.resetAt };
      return { ok: false, state: composer ? 'blocked-unknown' : 'composer-missing' };
    }

    const existing = S.readText(composer);
    const hasDraft = S.norm(existing) !== '';
    const isOurs = S.sameText(existing, text);
    if (hasDraft && !isOurs && !overwriteDraft) return { ok: false, state: 'draft-present' };
    if (!isOurs) {
      const inserted = await S.setText(composer, text);
      if (!inserted) {
        await S.clearComposer(a.getComposer() || composer);
        return { ok: false, state: 'insert-failed' };
      }
    }

    const button = await S.waitFor(() => {
      const b = a.getSendButton();
      return b && S.isEnabled(b) ? b : null;
    }, 5000);

    if (button) {
      button.click();
    } else {
      const banner = S.findLimitBanner(a);
      if (banner) {
        await dropOurDraft(a, text);
        return { ok: false, state: 'limit-reached', resetAt: banner.resetAt };
      }
      S.pressEnter(a.getComposer() || composer);
    }

    let ok = await S.waitFor(() => verifySent(a, text, baseline), 8000, 200);
    if (!ok && button) {
      const banner = S.findLimitBanner(a);
      if (banner) {
        await dropOurDraft(a, text);
        return { ok: false, state: 'limit-reached', resetAt: banner.resetAt };
      }
      S.pressEnter(a.getComposer() || composer);
      ok = await S.waitFor(() => verifySent(a, text, baseline), 4000, 200);
    }
    if (ok) return { ok: true };

    const banner = S.findLimitBanner(a);
    await dropOurDraft(a, text);
    if (banner) return { ok: false, state: 'limit-reached', resetAt: banner.resetAt };
    return { ok: false, state: button ? 'unverified' : 'send-button-missing' };
  }

  async function checkSent(arg) {
    const a = adapter();
    if (!a) return { sent: false };
    const users = a.userMessages();
    const grew = users.length > ((arg.baseline && arg.baseline.user) || 0);
    const last = users.length ? S.norm(users[users.length - 1].textContent) : '';
    return { sent: grew && last.includes(S.norm(arg.text).slice(0, 60)) };
  }

  async function waitForReply(arg) {
    const a = adapter();
    if (!a) return { state: 'no-adapter' };
    const baseline = arg.baseline || { assistant: 0, assistantLen: 0 };
    const quietMs = arg.quietMs || 3000;
    const noReplyMs = arg.noReplyMs || 60000;
    const sinceMs = arg.sinceMs || Date.now();

    if (!root.__PA_WAIT || root.__PA_WAIT.key !== arg.key) {
      root.__PA_WAIT = { key: arg.key, seen: false, sig: '', changedAt: Date.now() };
    }
    const st = root.__PA_WAIT;
    const end = Date.now() + (arg.maxMs || 20000);

    for (;;) {
      const generating = a.isGenerating();
      const snap = snapshot(a);
      const sig = snap.assistant + ':' + snap.assistantLen;
      if (sig !== st.sig) {
        st.sig = sig;
        st.changedAt = Date.now();
      }
      if (generating || snap.assistant > baseline.assistant || snap.assistantLen !== baseline.assistantLen) st.seen = true;

      if (st.seen && !generating) {
        const composer = a.getComposer();
        if (!composer || S.isDisabled(composer)) {
          const banner = S.findLimitBanner(a);
          if (banner) return { state: 'limit-reached', resetAt: banner.resetAt };
        }
        if (Date.now() - st.changedAt >= quietMs) return { state: 'done' };
      }
      if (!st.seen && Date.now() - sinceMs >= noReplyMs) return { state: 'no-reply' };
      if (Date.now() >= end) return { state: 'generating' };
      await S.sleep(1000);
    }
  }

  async function selfTest() {
    const a = adapter();
    if (!a) return { adapter: null, ok: false, note: 'No adapter for this site.' };
    const end = Date.now() + 12000;
    let composer = a.getComposer();
    while (!composer && Date.now() < end) {
      await S.sleep(500);
      composer = a.getComposer();
    }
    const signedOut = a.isSignedOut();
    const banner = S.findLimitBanner(a);
    return {
      adapter: a.id,
      lastVerified: a.lastVerified,
      url: location.href,
      signedOut,
      composerFound: !!composer,
      composerEmpty: composer ? S.norm(S.readText(composer)) === '' : null,
      limitNotice: banner ? banner.text : null,
      limitResetAt: banner ? banner.resetAt : null,
      counts: snapshot(a),
      ok: !!composer && !signedOut,
    };
  }

  /**
   * Reads the reset time from a usage-limit notice on the page. Sends nothing. The notice only
   * exists while a limit is active, so "found: false" means there is nothing to read right now.
   */
  async function readReset(arg) {
    const a = adapter();
    if (!a) return { found: false, adapter: null, signedOut: false, text: null, resetAt: null };
    const end = Date.now() + (arg.waitMs || 8000);
    let banner = null;
    for (;;) {
      banner = S.findLimitBanner(a);
      if ((banner && banner.resetAt) || Date.now() >= end) break;
      await S.sleep(500);
    }
    return {
      found: !!banner,
      adapter: a.id,
      signedOut: a.isSignedOut(),
      text: banner ? banner.text : null,
      resetAt: banner ? banner.resetAt : null,
    };
  }

  const METHODS = { preflight, sendPrompt, checkSent, waitForReply, selfTest, readReset };

  root.__PA = {
    async call(method, arg) {
      try {
        const fn = METHODS[method];
        if (!fn) return { __error: 'unknown method ' + method };
        return await fn(arg || {});
      } catch (e) {
        return { __error: String((e && e.message) || e) };
      }
    },
  };
  root.__PA_VERSION = VERSION;
  root.__PA_READY = true;
})(typeof globalThis !== 'undefined' ? globalThis : this);
