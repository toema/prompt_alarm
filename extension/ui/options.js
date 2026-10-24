import {
  h,
  send,
  readState,
  nextRunOf,
  describeTrigger,
  providerName,
  activeRunOf,
  runLine,
  paintNight,
  nightMarkup,
  statusChip,
  formatWhen,
  formatClock,
  selfTestText,
} from './common.js';
import { normalizeTargetUrl, providerForUrl, PROVIDERS } from '../shared/providers.js';
import { reasonText } from '../shared/reasons.js';
import { localTimeZone, toLocalInput, zonedToMs, partsInTz } from '../core/time.js';
import { retimeTrigger } from '../core/resync.js';

const $ = (id) => document.getElementById(id);
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let state = await readState();
let view = 'schedules';
let editingId = null;
let editingEnabled = true;
let toastTimer = null;
const night = nightMarkup();
$('night-slot').append(night);

// ------------------------------------------------------------------ helpers

function toast(message, tone) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  el.style.background = tone === 'good' ? 'var(--good-wash)' : tone === 'bad' ? 'var(--bad-wash)' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 7000);
}

async function requestSiteAccess(url) {
  const norm = normalizeTargetUrl(url);
  if (!norm.ok) return { ok: false, error: norm.error };
  const provider = PROVIDERS[norm.provider];
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: provider.origins });
  } catch (e) {
    granted = false;
  }
  if (!granted) {
    return {
      ok: false,
      error: `PromptAlarm needs access to ${provider.name} to open the chat at the scheduled time. Choose Allow to continue.`,
    };
  }
  return { ok: true, provider: provider.name };
}

function nextFiveAm() {
  const tz = localTimeZone();
  const now = Date.now();
  const p = partsInTz(now, tz);
  let ms = zonedToMs(p.y, p.mo, p.d, 5, 0, tz);
  if (ms <= now + 60000) {
    const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + 1));
    ms = zonedToMs(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), 5, 0, tz);
  }
  return toLocalInput(ms, tz);
}

// ------------------------------------------------------------------ rendering

function setView(next) {
  view = next;
  for (const name of ['schedules', 'history', 'settings']) {
    $('view-' + name).hidden = name !== view;
  }
  for (const a of document.querySelectorAll('nav.tabs a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  render();
}

function render() {
  paintNight(night, state);
  $('armed').checked = !state.settings.paused;
  $('armed-label').textContent = state.settings.paused ? 'PromptAlarm is off' : 'PromptAlarm is on';
  if (view === 'schedules') renderSchedules();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
}

function renderSchedules() {
  const box = $('schedules');
  const { schedules, runs } = state;
  if (schedules.length === 0) {
    box.replaceChildren(
      h(
        'div',
        { class: 'panel empty-state' },
        h('h2', null, 'Nothing scheduled yet'),
        h(
          'ol',
          null,
          h('li', null, 'Open the AI chat you want to continue and copy its link.'),
          h('li', null, 'Choose New schedule, paste the link, and pick the time your limit resets.'),
          h('li', null, 'Write the prompt, for example: Continue from where we stopped.')
        ),
        h('button', { class: 'btn primary', onclick: () => openEditor(null) }, 'New schedule'),
        h(
          'div',
          { class: 'notice' },
          'Chrome has to be open and the computer awake at the scheduled time. PromptAlarm cannot run while the computer sleeps.'
        )
      )
    );
    return;
  }
  box.replaceChildren(
    h(
      'div',
      { class: 'panel' },
      h(
        'ul',
        { class: 'list' },
        schedules.map((s) => {
          const run = activeRunOf(runs, s.id);
          const next = nextRunOf(s);
          let when;
          if (run) when = runLine(run);
          else if (!s.enabled) when = s.trigger.type === 'once' && s.lastRunAt ? 'Finished' : 'Off';
          else when = next ? `Next run ${formatWhen(next, s.trigger.tz)}` : 'No upcoming run';
          const first = s.steps[0].text.replace(/\s+/g, ' ');
          return h(
            'li',
            null,
            h(
              'div',
              { class: 'top' },
              h('div', null, h('div', { class: 'name' }, s.name), h('div', { class: 'muted small' }, `${providerName(s.target.provider)}, ${describeTrigger(s.trigger)}${syncNote(s)}`)),
              h(
                'label',
                { class: 'switch' },
                h('input', {
                  type: 'checkbox',
                  checked: s.enabled,
                  'aria-label': `${s.name} is on`,
                  onchange: async (e) => {
                    const res = await send('schedule/toggle', { id: s.id, enabled: e.target.checked });
                    if (!res.ok) {
                      e.target.checked = !e.target.checked;
                      toast(res.error, 'bad');
                    }
                  },
                })
              )
            ),
            h('div', { class: 'muted small', style: 'margin-top:4px' }, first.length > 110 ? first.slice(0, 110) + '...' : first),
            h(
              'div',
              { class: 'sched-line' },
              h('span', { class: 'small grow' }, when),
              run
                ? h('button', { class: 'btn quiet danger', onclick: () => send('run/cancel', { id: run.id }) }, 'Cancel run')
                : h('button', { class: 'btn quiet', onclick: async () => {
                    const res = await send('schedule/runNow', { id: s.id });
                    toast(res.ok ? 'Started a run. Watch it in History.' : res.error, res.ok ? 'good' : 'bad');
                  } }, 'Run now'),
              h('button', { class: 'btn quiet', onclick: () => openEditor(s) }, 'Edit'),
              h('button', { class: 'btn quiet', onclick: async () => {
                  const res = await send('schedule/duplicate', { id: s.id });
                  toast(res.ok ? 'Copied. The copy is off until you turn it on.' : res.error, res.ok ? 'good' : 'bad');
                } }, 'Duplicate'),
              h('button', { class: 'btn quiet danger', onclick: async () => {
                  if (confirm(`Delete "${s.name}"?`)) await send('schedule/delete', { id: s.id });
                } }, 'Delete')
            )
          );
        })
      )
    )
  );
}

function syncNote(s) {
  if (!s.resetSync || !s.resetSync.enabled) return '';
  if (!s.resetSync.lastResetAt) return ' (follows the site\'s reset time)';
  return ` (follows the site's reset time, last read ${formatWhen(s.resetSync.lastResetAt, s.trigger.tz)})`;
}

function renderHistory() {
  const { runs, settings } = state;
  $('history-note').textContent = `Kept for ${settings.logRetentionDays} days on this computer. Prompts and replies are never logged.`;
  $('clear-history').hidden = runs.every((r) => ['queued', 'running', 'blocked'].includes(r.status));
  if (runs.length === 0) {
    $('history').replaceChildren(
      h('div', { class: 'panel empty-state' }, h('h2', null, 'No runs yet'), h('p', { class: 'muted' }, 'Each run shows up here with what happened and why.'))
    );
    return;
  }
  $('history').replaceChildren(
    h(
      'div',
      { class: 'panel' },
      h(
        'ul',
        { class: 'list history' },
        runs.map((r) => {
          const reason = reasonText(r.reasonCode);
          const attempts = r.attempts || [];
          return h(
            'li',
            null,
            h('div', { class: 'small muted' }, formatWhen(r.scheduledFor), r.manual ? ' (manual)' : ''),
            h('div', null, h('div', { class: 'name' }, r.scheduleName), reason ? h('div', { class: 'small muted' }, reason) : null),
            statusChip(r.status),
            attempts.length > 1 || (attempts.length === 1 && attempts[0].outcome !== 'sent')
              ? h(
                  'details',
                  null,
                  h('summary', null, `${r.attemptCount || attempts.length} attempt${(r.attemptCount || attempts.length) === 1 ? '' : 's'}`),
                  h(
                    'ol',
                    { class: 'attempts' },
                    attempts.map((a) =>
                      h('li', { style: 'border:0;padding:0;display:list-item' }, `${new Date(a.at).toLocaleTimeString()}: ${a.outcome === 'sent' ? 'Message sent.' : reasonText(a.outcome) || a.outcome}`)
                    )
                  )
                )
              : null
          );
        })
      )
    )
  );
}

function setting(title, text, control) {
  return h('div', { class: 'setting' }, h('div', null, h('b', null, title), h('p', null, text)), control);
}

function renderSettings() {
  const { settings } = state;
  $('version').textContent = `PromptAlarm ${chrome.runtime.getManifest().version}`;
  $('settings').replaceChildren(
    setting(
      'Keep the computer awake',
      'Stops the computer from sleeping when a run is due within 12 hours. The screen can still turn off.',
      h(
        'label',
        { class: 'switch' },
        h('input', {
          type: 'checkbox',
          checked: settings.keepAwake,
          'aria-label': 'Keep the computer awake',
          onchange: async (e) => {
            if (e.target.checked) {
              const ok = await chrome.permissions.request({ permissions: ['power'] }).catch(() => false);
              if (!ok) {
                e.target.checked = false;
                return;
              }
            }
            await send('settings/update', { patch: { keepAwake: e.target.checked } });
          },
        })
      )
    ),
    setting(
      'Notifications',
      'Show a desktop notification when a run finishes or fails.',
      h(
        'label',
        { class: 'switch' },
        h('input', {
          type: 'checkbox',
          checked: settings.notifications,
          'aria-label': 'Notifications',
          onchange: async (e) => {
            if (e.target.checked) {
              const ok = await chrome.permissions.request({ permissions: ['notifications'] }).catch(() => false);
              if (!ok) {
                e.target.checked = false;
                return;
              }
            }
            await send('settings/update', { patch: { notifications: e.target.checked } });
          },
        })
      )
    ),
    setting(
      'History',
      'How long finished runs are kept.',
      h(
        'select',
        {
          'aria-label': 'History kept for',
          onchange: (e) => send('settings/update', { patch: { logRetentionDays: Number(e.target.value) } }),
        },
        [7, 30, 90, 365].map((d) => h('option', { value: String(d), selected: settings.logRetentionDays === d }, `${d} days`))
      )
    )
  );
}

// ------------------------------------------------------------------ editor

const form = $('editor-form');
const editor = $('editor');

function buildTimeZones(selected) {
  const sel = $('f-tz');
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch (e) {
    zones = [];
  }
  const local = localTimeZone();
  if (!zones.includes(local)) zones.unshift(local);
  if (selected && !zones.includes(selected)) zones.unshift(selected);
  sel.replaceChildren(...zones.map((z) => h('option', { value: z, selected: z === (selected || local) }, z === local ? `${z} (this computer)` : z)));
}

function buildDays(days) {
  $('f-days').replaceChildren(
    ...DAY_LABELS.map((label, i) =>
      h('label', null, h('input', { type: 'checkbox', value: String(i), checked: days.includes(i), 'aria-label': label }), h('span', null, label))
    )
  );
}

function stepNode(text, index) {
  return h(
    'div',
    { class: 'step' },
    h(
      'div',
      { class: 'step-head' },
      h('span', null, index === 0 ? 'First prompt' : `Follow-up ${index}`),
      index === 0
        ? null
        : h('button', { type: 'button', class: 'btn quiet danger', onclick: (e) => { e.target.closest('.step').remove(); relabelSteps(); } }, 'Remove')
    ),
    h('textarea', { rows: 4, 'aria-label': index === 0 ? 'First prompt' : `Follow-up ${index}`, placeholder: index === 0 ? 'Continue from where we stopped.' : '' }, text || '')
  );
}

function relabelSteps() {
  [...$('steps').children].forEach((el, i) => {
    el.querySelector('.step-head span').textContent = i === 0 ? 'First prompt' : `Follow-up ${i}`;
    el.querySelector('textarea').setAttribute('aria-label', i === 0 ? 'First prompt' : `Follow-up ${i}`);
  });
}

function setTriggerUi() {
  const type = form.elements.trigger.value;
  $('once-box').hidden = type !== 'once';
  $('daily-box').hidden = type !== 'daily';
  $('sync-box').hidden = type !== 'daily';
}

function showErrors(list) {
  const box = $('editor-errors');
  if (!list || list.length === 0) {
    box.hidden = true;
    return;
  }
  box.replaceChildren(h('ul', null, list.map((e) => h('li', null, e))));
  box.hidden = false;
}

function openEditor(schedule, prefillUrl) {
  editingId = schedule ? schedule.id : null;
  editingEnabled = schedule ? schedule.enabled : true;
  $('editor-title').textContent = schedule ? 'Edit schedule' : 'New schedule';
  $('f-name').value = schedule ? schedule.name : '';
  $('f-url').value = schedule ? schedule.target.url : prefillUrl || '';
  const t = schedule ? schedule.trigger : null;
  form.elements.trigger.value = t ? t.type : 'once';
  $('f-once').value = t && t.type === 'once' ? t.at : nextFiveAm();
  $('f-time').value = t && t.type === 'daily' ? t.time : '05:00';
  buildDays(t && t.type === 'daily' ? t.days : [0, 1, 2, 3, 4, 5, 6]);
  buildTimeZones(t ? t.tz : localTimeZone());
  const steps = schedule ? schedule.steps : [{ text: '', waitForReply: true }];
  $('steps').replaceChildren(...steps.map((s, i) => stepNode(s.text, i)));
  $('f-wait').checked = schedule ? steps[steps.length - 1].waitForReply !== false : true;
  const r = schedule ? schedule.retry : { enabled: true, intervalMin: 10, windowMin: 360 };
  $('f-retry').checked = r.enabled;
  $('f-interval').value = r.intervalMin;
  $('f-window').value = r.windowMin / 60;
  $('f-grace').value = (schedule ? schedule.graceMin : 120) / 60;
  $('f-cap').value = schedule ? schedule.maxMessagesPerRun : 1;
  $('f-overwrite').checked = schedule ? schedule.overwriteDraft : false;
  $('f-sync').checked = !!(schedule && schedule.resetSync && schedule.resetSync.enabled);
  $('f-buffer').value = schedule && schedule.resetSync ? schedule.resetSync.bufferMin : 1;
  $('detect-result').textContent = '';
  $('detect-result').className = 'check-result grow';
  $('check-result').textContent = '';
  $('check-result').className = 'check-result grow';
  showErrors([]);
  hintForUrl();
  setTriggerUi();
  editor.showModal();
  $('f-name').focus();
}

function hintForUrl() {
  const hint = $('f-url-hint');
  const value = $('f-url').value.trim();
  if (!value) {
    hint.textContent = 'Open the conversation, copy the address from the address bar, and paste it here.';
    return;
  }
  const norm = normalizeTargetUrl(value);
  hint.textContent = norm.ok ? `Detected: ${providerName(norm.provider)}.` : norm.error;
}

function collect() {
  const type = form.elements.trigger.value;
  const tz = $('f-tz').value;
  const texts = [...$('steps').querySelectorAll('textarea')].map((t) => t.value.trim()).filter(Boolean);
  const steps = texts.map((text, i) => ({
    id: `step-${i + 1}`,
    text,
    waitForReply: i < texts.length - 1 ? true : $('f-wait').checked,
    timeoutSec: 600,
  }));
  const cap = Math.max(Number($('f-cap').value) || 1, steps.length > 1 ? steps.length : 1);
  return {
    id: editingId || undefined,
    name: $('f-name').value,
    enabled: editingEnabled,
    target: { url: $('f-url').value.trim() },
    trigger:
      type === 'once'
        ? { type: 'once', at: $('f-once').value, tz }
        : {
            type: 'daily',
            time: $('f-time').value,
            days: [...$('f-days').querySelectorAll('input:checked')].map((i) => Number(i.value)),
            tz,
          },
    steps,
    retry: {
      enabled: $('f-retry').checked,
      intervalMin: Number($('f-interval').value),
      windowMin: Number($('f-window').value) * 60,
    },
    graceMin: Number($('f-grace').value) * 60,
    maxMessagesPerRun: cap,
    overwriteDraft: $('f-overwrite').checked,
    resetSync: { enabled: type === 'daily' && $('f-sync').checked, bufferMin: Number($('f-buffer').value) },
  };
}

async function openChecklist(schedule) {
  const provider = providerForUrl(schedule.target.url);
  $('cl-site').textContent = `Stay signed in to ${provider ? provider.name : 'the chat site'} in this Chrome profile.`;
  $('cl-awake').checked = state.settings.keepAwake;
  $('cl-result').textContent = '';
  $('cl-run').onclick = async () => {
    const res = await send('schedule/runNow', { id: schedule.id });
    $('cl-result').textContent = res.ok ? ' Started. Watch it in History.' : ` ${res.error}`;
  };
  $('cl-awake').onchange = async (e) => {
    if (e.target.checked) {
      const ok = await chrome.permissions.request({ permissions: ['power'] }).catch(() => false);
      if (!ok) {
        e.target.checked = false;
        return;
      }
    }
    await send('settings/update', { patch: { keepAwake: e.target.checked } });
  };
  $('checklist').showModal();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = collect();
  // Ask for site access first, while the click is still fresh.
  const access = await requestSiteAccess(input.target.url);
  if (!access.ok) return showErrors([access.error]);
  $('editor-save').disabled = true;
  try {
    const wasNew = !editingId;
    const res = await send('schedule/save', { schedule: input });
    if (!res.ok) return showErrors(res.errors || [res.error || 'Could not save.']);
    editor.close();
    if (wasNew) openChecklist(res.schedule);
    else toast('Saved.', 'good');
  } finally {
    $('editor-save').disabled = false;
  }
});

$('check-page').addEventListener('click', async () => {
  const out = $('check-result');
  out.className = 'check-result grow';
  const access = await requestSiteAccess($('f-url').value);
  if (!access.ok) {
    out.textContent = access.error;
    out.classList.add('bad');
    return;
  }
  out.textContent = 'Opening the page in the background...';
  const res = await send('target/selfTest', { url: $('f-url').value.trim() });
  const text = selfTestText(res);
  out.textContent = text.text;
  out.classList.add(text.ok ? 'ok' : 'bad');
});

$('detect-reset').addEventListener('click', async () => {
  const out = $('detect-result');
  const say = (text, kind) => {
    out.className = 'check-result grow' + (kind ? ' ' + kind : '');
    out.textContent = text;
  };
  const url = $('f-url').value.trim();
  const norm = normalizeTargetUrl(url);
  if (!norm.ok) return say(norm.error, 'bad');
  const access = await requestSiteAccess(url);
  if (!access.ok) return say(access.error, 'bad');
  $('detect-reset').disabled = true;
  say('Opening the page in the background...');
  try {
    const res = await send('target/detectReset', { url });
    if (!res.ok) return say(res.error || 'Could not read the page.', 'bad');
    const r = res.result;
    if (r.signedOut) return say('The page asks you to sign in. Sign in, then try again.', 'bad');
    if (!r.found) {
      return say('No usage-limit notice on the page right now, so there is no reset time to read. Try again while the limit is active.', 'bad');
    }
    if (!r.resetAt) return say('There is a limit notice, but no reset time could be read from it.', 'bad');
    const tz = $('f-tz').value;
    const type = form.elements.trigger.value;
    const { trigger, targetMs } = retimeTrigger(
      type === 'once' ? { type: 'once', at: '', tz } : { type: 'daily', time: '', tz },
      r.resetAt,
      Number($('f-buffer').value)
    );
    if (type === 'once') $('f-once').value = trigger.at;
    else $('f-time').value = trigger.time;
    say(`The site says the limit resets at ${formatClock(r.resetAt, tz)}. Set to ${formatClock(targetMs, tz)}. Save to apply.`, 'ok');
  } finally {
    $('detect-reset').disabled = false;
  }
});

$('add-step').addEventListener('click', () => {
  if ($('steps').children.length >= 10) return;
  $('steps').append(stepNode('', $('steps').children.length));
});
$('f-url').addEventListener('input', hintForUrl);
for (const r of form.elements.trigger) r.addEventListener('change', setTriggerUi);
$('editor-cancel').addEventListener('click', () => editor.close());
$('cl-done').addEventListener('click', () => $('checklist').close());

// ------------------------------------------------------------------ page wiring

$('new').addEventListener('click', () => openEditor(null));
$('armed').addEventListener('change', (e) => send('settings/update', { patch: { paused: !e.target.checked } }));
$('clear-history').addEventListener('click', async () => {
  if (confirm('Clear the run history?')) await send('history/clear');
});

$('export').addEventListener('click', async () => {
  if (!confirm('The file contains your prompts as plain text. Keep it somewhere private. Continue?')) return;
  const res = await send('data/export');
  if (!res.ok) return toast(res.error || 'Could not export.', 'bad');
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'promptalarm-schedules.json' });
  document.body.append(a);
  a.click();
  a.remove();
});

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    return toast('That file is not valid JSON.', 'bad');
  }
  const res = await send('data/import', { file: data });
  if (!res.ok) return toast(res.error, 'bad');
  const skipped = res.skipped.length ? ` ${res.skipped.length} skipped: ${res.skipped[0]}` : '';
  toast(`Imported ${res.imported} schedule${res.imported === 1 ? '' : 's'}. You may need to re-approve site access when you edit them.${skipped}`, res.imported ? 'good' : 'bad');
});

chrome.storage.onChanged.addListener(async () => {
  state = await readState();
  render();
});
setInterval(() => paintNight(night, state), 30000);

function route() {
  const hash = location.hash || '#schedules';
  if (hash.startsWith('#new')) {
    const m = /^#new=(.*)$/.exec(hash);
    setView('schedules');
    history.replaceState(null, '', '#schedules');
    openEditor(null, m ? decodeURIComponent(m[1]) : '');
    return;
  }
  const name = hash.slice(1);
  setView(['schedules', 'history', 'settings'].includes(name) ? name : 'schedules');
}
window.addEventListener('hashchange', route);
route();
send('seen');
