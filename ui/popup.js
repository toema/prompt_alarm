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
  formatWhen,
  selfTestText,
} from './common.js';
import { providerForUrl, normalizeTargetUrl, PROVIDERS } from '../shared/providers.js';

const root = document.getElementById('root');
let state = null;
let tabUrl = null;
let checkMessage = '';
let night = null;

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // activeTab makes the address readable for the tab the person is looking at.
    tabUrl = tab && tab.url && providerForUrl(tab.url) ? tab.url : null;
  } catch (e) {
    tabUrl = null;
  }
  state = await readState();
  render();
  chrome.storage.onChanged.addListener(async () => {
    state = await readState();
    render();
  });
  setInterval(() => night && paintNight(night, state), 30000);
  send('seen');
}

function openDashboard(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html' + (hash || '')) });
  window.close();
}

async function runCheck() {
  const norm = normalizeTargetUrl(tabUrl);
  if (!norm.ok) return;
  checkMessage = 'Checking the page...';
  render();
  const origins = PROVIDERS[norm.provider].origins;
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins });
  } catch (e) {
    granted = false;
  }
  if (!granted) {
    checkMessage = `Allow access to ${providerName(norm.provider)} first, then check again.`;
    render();
    return;
  }
  const res = await send('target/selfTest', { url: tabUrl });
  checkMessage = selfTestText(res).text;
  render();
}

function scheduleRow(s) {
  const run = activeRunOf(state.runs, s.id);
  const next = nextRunOf(s);
  let line;
  if (run) line = runLine(run);
  else if (!s.enabled) line = s.trigger.type === 'once' && s.lastRunAt ? 'Finished' : 'Off';
  else line = next ? `Next run ${formatWhen(next, s.trigger.tz)}` : 'No upcoming run';

  return h(
    'li',
    null,
    h(
      'div',
      { class: 'top' },
      h('div', { class: 'name', title: s.name }, s.name),
      h(
        'label',
        { class: 'switch', title: s.enabled ? 'Turn off' : 'Turn on' },
        h('input', {
          type: 'checkbox',
          checked: s.enabled,
          'aria-label': `${s.name} is on`,
          onchange: async (e) => {
            const res = await send('schedule/toggle', { id: s.id, enabled: e.target.checked });
            if (!res.ok) {
              e.target.checked = !e.target.checked;
              checkMessage = res.error;
              render();
            }
          },
        })
      )
    ),
    h('div', { class: 'meta' }, h('span', null, `${providerName(s.target.provider)}, ${describeTrigger(s.trigger)}`)),
    h(
      'div',
      { class: 'meta' },
      h('span', null, line),
      run
        ? h('button', { class: 'btn quiet danger', onclick: () => send('run/cancel', { id: run.id }) }, 'Cancel run')
        : h('button', { class: 'btn quiet', onclick: () => send('schedule/runNow', { id: s.id }) }, 'Run now')
    )
  );
}

function render() {
  if (!state) return;
  const { settings, schedules } = state;

  night = nightMarkup();
  const armed = h('input', {
    type: 'checkbox',
    checked: !settings.paused,
    'aria-label': 'PromptAlarm is on',
    onchange: (e) => send('settings/update', { patch: { paused: !e.target.checked } }),
  });

  const children = [
    h('div', { class: 'bar' }, h('strong', null, 'PromptAlarm'), h('label', { class: 'switch' }, h('span', { class: 'small' }, settings.paused ? 'Off' : 'On'), armed)),
    night,
  ];

  if (schedules.length === 0) {
    children.push(
      h(
        'div',
        { class: 'empty' },
        tabUrl
          ? 'Schedule this chat to send a prompt while you sleep.'
          : 'Open a Claude, ChatGPT or Gemini chat, then click the icon again, or start in the dashboard.'
      )
    );
  } else {
    children.push(h('ul', { class: 'list' }, schedules.map(scheduleRow)));
  }

  const footer = h('footer', null);
  if (tabUrl) {
    footer.append(
      h('button', { class: 'btn primary', onclick: () => openDashboard('#new=' + encodeURIComponent(tabUrl)) }, 'Schedule this chat'),
      h('button', { class: 'btn quiet', onclick: runCheck }, 'Check this page')
    );
  } else {
    footer.append(h('button', { class: 'btn primary', onclick: () => openDashboard('#new') }, 'New schedule'));
  }
  footer.append(h('span', { class: 'grow' }), h('button', { class: 'btn quiet', onclick: () => openDashboard('') }, 'Dashboard'));
  children.push(footer);
  if (checkMessage) children.push(h('div', { class: 'result', role: 'status' }, checkMessage));

  root.replaceChildren(...children);
  paintNight(night, state);
}

init();
