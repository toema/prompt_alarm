// PromptAlarm service worker. Listeners are registered synchronously at the top level so
// Chrome can wake the worker for them. The worker keeps nothing in memory that matters:
// every wake-up rebuilds from storage.

import { reconcile } from './scheduler.js';
import { pump } from './orchestrator.js';
import { migrate } from './storage.js';
import { ensureBaseAlarms } from './system.js';
import { handleMessage } from './messages.js';

const log = (e) => console.warn('[PromptAlarm]', e);

async function bootstrap() {
  await migrate();
  await ensureBaseAlarms();
  await reconcile('wake');
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html#welcome') }).catch(log);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconcile' || alarm.name.startsWith('sched:')) {
    reconcile(alarm.name).catch(log);
  } else if (alarm.name === 'watchdog' || alarm.name.startsWith('run:')) {
    pump().catch(log);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only the extension's own pages may talk to the worker.
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

bootstrap().catch(log);
