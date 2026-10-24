// PromptAlarm page toolkit. Classic script, injected into a chat tab when a run starts.
// Adapters (content/adapters/*.js) register themselves in globalThis.__PA_ADAPTERS and
// only describe where things are on a site; all behavior lives in runner.js.
(function (root) {
  'use strict';

  // Every injection starts from a clean adapter list so updates never leave stale copies.
  root.__PA_ADAPTERS = [];

  const LIMIT_PATTERNS = [
    /\b(reached|hit|exceeded|used up|ran out of|run out of)\b.{0,60}\b(limit|cap|quota|allowance)\b/i,
    /\b(usage|message|rate|daily|weekly|hourly|5-hour|free[- ]plan)\s+(limit|cap|quota)\b/i,
    /\blimit\b.{0,40}\b(reset|resets|resetting|renews?|refreshes)\b/i,
    /\bout of (free )?(messages|prompts|requests)\b/i,
    /\btoo many (requests|messages)\b/i,
    /\b(come back|try again|available again)\b.{0,40}\b(at|after|in|tomorrow|later|until)\b/i,
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs, stepMs) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(stepMs || 150);
    }
  }

  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function sameText(a, b) {
    return norm(a) === norm(b);
  }

  function isVisible(el) {
    if (!el || el.hidden) return false;
    if (!el.getClientRects().length) return false;
    const cs = root.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function queryAll(sel, scope) {
    try {
      return Array.from((scope || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }

  /** First visible element of the first selector that matches anything. */
  function firstVisible(selectors, scope) {
    for (const sel of selectors) {
      for (const el of queryAll(sel, scope)) if (isVisible(el)) return el;
    }
    return null;
  }

  /** Elements of the first selector that matches anything (selectors are alternatives, never summed). */
  function allOfFirst(selectors, scope) {
    for (const sel of selectors) {
      const list = queryAll(sel, scope);
      if (list.length) return list;
    }
    return [];
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.getAttribute('contenteditable') === 'false') return true;
    if (el.readOnly) return true;
    return false;
  }

  function isEnabled(el) {
    return !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  }

  function readText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.innerText != null ? el.innerText : el.textContent || '';
  }

  function selectAllIn(el) {
    el.focus();
    const sel = root.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function clearComposer(el) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    selectAllIn(el);
    document.execCommand('delete');
    await sleep(80);
  }

  /**
   * Puts text into a composer the way the editor expects it.
   * Rich editors get a synthetic paste first, then editing commands as a fallback.
   * Returns true when the box now holds exactly the text.
   */
  async function setText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(120);
      return sameText(readText(el), text);
    }

    selectAllIn(el);
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) {
      /* fall through to editing commands */
    }
    await sleep(250);
    if (sameText(readText(el), text)) return true;

    selectAllIn(el);
    document.execCommand('delete');
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) document.execCommand('insertLineBreak');
      if (lines[i]) document.execCommand('insertText', false, lines[i]);
    }
    await sleep(250);
    return sameText(readText(el), text);
  }

  function pressEnter(el) {
    el.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(
        new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
    }
  }

  function matchesLimit(text) {
    return LIMIT_PATTERNS.some((re) => re.test(text));
  }

  // Small time-zone helpers (this file is a classic script, so it cannot import core/time.js).
  const localZone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  };

  function wallParts(ms, tz) {
    const o = {};
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
    if (o.hour === 24) o.hour = 0;
    return o;
  }

  function zoneOffset(ms, tz) {
    const p = wallParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }

  /** Instant of a wall-clock time in a zone (first occurrence if ambiguous). */
  function zonedMs(y, mo, d, h, mi, tz) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const off1 = zoneOffset(guess, tz);
    const t1 = guess - off1;
    const off2 = zoneOffset(t1, tz);
    if (off1 === off2) return t1;
    const t2 = guess - off2;
    return zoneOffset(t2, tz) === off2 ? t2 : Math.max(t1, t2);
  }

  /** A zone named in the message, like "(Africa/Cairo)" or "UTC". Null when none or not a real zone. */
  function zoneInText(t) {
    const m = /\b([A-Z][A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})\b/.exec(t);
    const name = m ? m[1] : /\bUTC\b/.test(t) ? 'UTC' : null;
    if (!name) return null;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: name });
      return name;
    } catch (e) {
      return null;
    }
  }

  /**
   * Reads a reset time out of a limit message ("resets at 5:00 AM", "resets 5am (Africa/Cairo)",
   * "try again in 2 hours 15 minutes"). Clock times without a zone are in the browser's zone,
   * which is how the sites show them. Returns an epoch ms within the next 48 hours, or null.
   */
  function parseResetTime(text, now) {
    now = now == null ? Date.now() : now;
    const t = String(text || '').replace(/\s+/g, ' ');
    let target = null;

    const rel =
      /\bin\s+(?:about\s+|around\s+|approximately\s+)?(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b)?|(\d+)\s*(?:minutes?|mins?|m)\b)/i.exec(
        t
      );
    if (rel) {
      const hours = rel[1] ? parseFloat(rel[1]) : 0;
      const minutes = rel[2] ? parseInt(rel[2], 10) : rel[3] ? parseInt(rel[3], 10) : 0;
      target = now + Math.round(hours * 3600000) + minutes * 60000;
    } else {
      const abs =
        /\b(?:at|after|by|until|till|around|from|resets?)\s+(?:(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?|(\d{1,2})\s*([ap]\.?m\.?))/i.exec(t);
      if (abs) {
        let h = parseInt(abs[1] || abs[4], 10);
        const m = abs[2] ? parseInt(abs[2], 10) : 0;
        const mer = (abs[3] || abs[5] || '').toLowerCase().replace(/\./g, '');
        if (mer === 'pm' && h < 12) h += 12;
        if (mer === 'am' && h === 12) h = 0;
        if (h <= 23 && m <= 59) {
          const zone = zoneInText(t) || localZone();
          const w = wallParts(now, zone);
          let at = zonedMs(w.year, w.month, w.day, h, m, zone);
          let addDays = 0;
          if (/\btomorrow\b/i.test(t) && at <= now + 12 * 3600000) addDays = 1;
          else if (at <= now) addDays = 1;
          if (addDays) {
            const d = new Date(Date.UTC(w.year, w.month - 1, w.day + addDays));
            at = zonedMs(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, zone);
          }
          target = at;
        }
      }
    }

    if (target == null) return null;
    if (target <= now || target > now + 48 * 3600000) return null;
    return target;
  }

  /**
   * Looks for a usage-limit notice outside the conversation, sidebar and links.
   * Returns { text, resetAt } or null.
   */
  function findLimitBanner(adapter) {
    if (!document.body) return null;
    const exclude = ((adapter && adapter.conversationSelectors) || []).join(',');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const v = node.nodeValue;
      if (!v || v.length < 12 || v.length > 400) continue;
      if (!matchesLimit(v)) continue;
      let el = node.parentElement;
      if (!el) continue;
      if (el.closest('script,style,noscript,textarea,[contenteditable="true"],[contenteditable=""],a,nav,aside')) continue;
      if (exclude && el.closest(exclude)) continue;
      if (!isVisible(el)) continue;
      let box = el;
      for (let i = 0; i < 2; i++) {
        const p = box.parentElement;
        if (!p || /^(BODY|MAIN|HTML)$/.test(p.tagName) || p.textContent.length > 300) break;
        box = p;
      }
      const text = norm(box.textContent).slice(0, 300);
      return { text, resetAt: parseResetTime(text) };
    }
    return null;
  }

  const SDK = {
    LIMIT_PATTERNS,
    sleep,
    waitFor,
    norm,
    sameText,
    isVisible,
    firstVisible,
    allOfFirst,
    isDisabled,
    isEnabled,
    readText,
    setText,
    clearComposer,
    pressEnter,
    matchesLimit,
    parseResetTime,
    findLimitBanner,
  };

  root.__PA_SDK = SDK;
  if (typeof module !== 'undefined' && module.exports) module.exports = SDK;
})(typeof globalThis !== 'undefined' ? globalThis : this);
