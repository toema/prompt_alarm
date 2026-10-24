// Smoke-tests the RELEASE build in Chromium and renders the Chrome Web Store images from it:
// five 1280x800 screenshots, the 440x280 small promo tile and the 1400x560 marquee.
// Run: node scripts/build.mjs && node scripts/store-assets.mjs
// The schedules and history shown are made-up example data seeded into the browser profile.

import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = join(root, 'dist', 'extension');
const outDir = join(root, 'store', 'images');
assert.ok(existsSync(join(extPath, 'manifest.json')), 'run `node scripts/build.mjs` first');
mkdirSync(outDir, { recursive: true });

// Prefer the project's own node_modules (npm install); PLAYWRIGHT_DIR is an optional fallback location.
const projectRequire = createRequire(join(root, 'package.json'));
const load = (name) => {
  try {
    return projectRequire(name);
  } catch {
    return createRequire(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/')(name);
  }
};
const { chromium } = load('playwright');
const sharp = load('sharp');

const profile = mkdtempSync(join(tmpdir(), 'pa-store-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  colorScheme: 'light',
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

const problems = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => problems.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${label}: ${m.text()}`));
};

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const extId = new URL(sw.url()).host;

const page = await ctx.newPage();
watch(page, 'options');
await page.goto(`chrome-extension://${extId}/ui/options.html`);

const manifest = await page.evaluate(() => chrome.runtime.getManifest());
assert.equal(manifest.manifest_version, 3);
assert.ok(!JSON.stringify(manifest).includes('localhost'), 'release manifest must not mention localhost');
const pong = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ping' }));
assert.ok(pong && pong.ok, 'service worker did not answer ping: ' + JSON.stringify(pong));
console.log('manifest ok, service worker answers:', JSON.stringify(pong));

// ---- seed example data
await page.evaluate(() => {
  const now = Date.now();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const step = (text) => ({ id: 's1', text, waitForReply: true, timeoutSec: 600 });
  const retry = { enabled: true, intervalMin: 10, windowMin: 360 };
  const base = { enabled: true, retry, graceMin: 120, maxMessagesPerRun: 1, overwriteDraft: false, createdAt: now - 864e5, handledUpTo: now, runCount: 4, revision: 1 };
  const schedules = [
    { ...base, id: 'a', name: 'Continue the novel', target: { provider: 'claude', url: 'https://claude.ai/chat/example-novel' },
      trigger: { type: 'daily', time: '05:00', days: [0, 1, 2, 3, 4, 5, 6], tz }, resetSync: { enabled: true, bufferMin: 1, lastResetAt: now - 18 * 3600000, lastSyncedAt: now - 18 * 3600000 }, steps: [step('Continue the story from where we stopped. Keep the same voice and aim for about 1,500 words.')] },
    { ...base, id: 'b', name: 'Refactor the billing module', target: { provider: 'chatgpt', url: 'https://chatgpt.com/c/example-billing' },
      trigger: { type: 'daily', time: '04:30', days: [1, 2, 3, 4, 5], tz }, steps: [step('Pick up the refactor where we left off and list what is still open at the end.')] },
    { ...base, id: 'c', name: 'Weekly research digest', target: { provider: 'gemini', url: 'https://gemini.google.com/app/example-digest' },
      trigger: { type: 'daily', time: '06:00', days: [1], tz }, steps: [step('Summarize new papers on retrieval for {{date}}.')], enabled: false },
  ];
  const h = (min) => now - min * 60000;
  const run = (id, name, provider, status, reasonCode, minutesAgo, attempts) => ({
    id, scheduleId: 'a', scheduleName: name, provider, scheduledFor: h(minutesAgo), createdAt: h(minutesAgo), endedAt: h(minutesAgo - 3),
    manual: false, status, reasonCode, attemptCount: attempts.length, attempts: attempts.map((o, i) => ({ at: h(minutesAgo - i * 10), outcome: o })), cursor: { phase: 'done' },
  });
  const runs = [
    run('r1', 'Continue the novel', 'claude', 'sent', '', 600, ['LIMIT_ACTIVE', 'LIMIT_ACTIVE', 'sent']),
    run('r2', 'Refactor the billing module', 'chatgpt', 'sent', '', 1040, ['sent']),
    run('r3', 'Continue the novel', 'claude', 'sent', '', 2040, ['sent']),
    run('r4', 'Refactor the billing module', 'chatgpt', 'failed', 'DRAFT_PRESENT', 2480, ['DRAFT_PRESENT']),
    run('r5', 'Weekly research digest', 'gemini', 'missed', 'MISSED_WINDOW', 4300, []),
    run('r6', 'Continue the novel', 'claude', 'sent', '', 3480, ['sent']),
  ];
  return chrome.storage.local.set({ schedules, runs, settings: { paused: false, keepAwake: true, notifications: true, logRetentionDays: 30, lastSeenAt: now, schemaVersion: 1 } });
});
await page.reload();
await page.waitForSelector('text=Continue the novel');

const shot = async (p, name, opts = {}) => {
  const buf = await p.screenshot(opts);
  await sharp(buf).flatten({ background: '#ffffff' }).removeAlpha().png().toFile(join(outDir, name));
  console.log('wrote', name);
};

// 1. dashboard
await shot(page, '1-schedules-1280x800.png');

// 2. editor
await page.click('text=Edit >> nth=0');
await page.waitForSelector('#editor[open]');
await page.waitForTimeout(200);
await shot(page, '2-editor-1280x800.png');
await page.click('#editor-cancel');

// 3. history
await page.click('nav.tabs a[data-view=history]');
await page.waitForSelector('text=Not sent');
await shot(page, '3-history-1280x800.png');

// 4. settings
await page.click('nav.tabs a[data-view=settings]');
await page.waitForSelector('text=Keep the computer awake');
await shot(page, '4-settings-1280x800.png');

// 5. popup composited onto a 1280x800 canvas
const popup = await ctx.newPage();
watch(popup, 'popup');
await popup.setViewportSize({ width: 372, height: 520 });
await popup.goto(`chrome-extension://${extId}/ui/popup.html`);
await popup.waitForSelector('text=Continue the novel');
const popupPng = await popup.screenshot({ fullPage: true });
const popupB64 = (await sharp(popupPng).png().toBuffer()).toString('base64');

const icon = readFileSync(join(extPath, 'icons', 'icon128.png')).toString('base64');
const compose = await ctx.newPage();
await compose.setViewportSize({ width: 1280, height: 800 });
await compose.setContent(`<!doctype html><meta charset=utf-8><style>
  body{margin:0;width:1280px;height:800px;background:#1a2150;color:#e8ebff;font:20px/1.45 system-ui,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;gap:88px;box-sizing:border-box;padding:0 96px}
  .t{flex:1 1 auto;min-width:0;max-width:600px}
  h1{font:650 52px/1.08 'Avenir Next','Segoe UI',system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 18px;text-wrap:balance}
  p{margin:0;color:#aeb6e6;max-width:480px}
  img.p{border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.45);width:372px;flex:none}
  em{font-style:normal;color:#f2a24b}
</style>
<div class=t><h1>Your prompt goes out <em>at the time you pick</em></h1><p>Open the chat you want to continue, choose a time, write the prompt. If your usage limit is still active, PromptAlarm tries again until it resets.</p></div>
<img class=p src="data:image/png;base64,${popupB64}">`);
await shot(compose, '5-popup-1280x800.png');

// ---- promo tiles
const tile = async (name, w, h, big, small) => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  const k = w / 440;
  await p.setContent(`<!doctype html><meta charset=utf-8><style>
    body{margin:0;width:${w}px;height:${h}px;background:#1a2150;color:#e8ebff;font-family:'Avenir Next','Segoe UI',system-ui,sans-serif;display:flex;align-items:center;gap:${28 * k}px;padding:0 ${36 * k}px;box-sizing:border-box}
    img{width:${(h > 400 ? 220 : 96 * k)}px;height:auto;flex:none}
    h1{font-size:${(h > 400 ? 64 : 34 * k)}px;line-height:1.05;letter-spacing:-.02em;margin:0 0 ${10 * k}px;font-weight:650}
    p{margin:0;font-size:${(h > 400 ? 26 : 15 * k)}px;line-height:1.35;color:#aeb6e6;text-wrap:balance}
    em{font-style:normal;color:#f2a24b}
  </style><img src="data:image/png;base64,${icon}"><div><h1>${big}</h1><p>${small}</p></div>`);
  await shot(p, name);
  await p.close();
};
await tile('promo-small-440x280.png', 440, 280, 'Prompt<em>Alarm</em>', 'Schedule prompts for your AI chats');
await tile('promo-marquee-1400x560.png', 1400, 560, 'Prompt<em>Alarm</em>', 'Sent at the time you pick, and retried until your usage limit resets.');

assert.deepEqual(problems, [], 'console errors in the release build:\n' + problems.join('\n'));
await ctx.close();
rmSync(profile, { recursive: true, force: true });
console.log('release smoke test passed, no console errors');
