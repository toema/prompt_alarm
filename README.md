# PromptAlarm

Schedule a prompt for your AI chat. PromptAlarm opens the chat link you give it at the time you choose, types your prompt and presses send. If your usage limit is still active, it tries again until the limit resets.

It is built for one situation: your Claude, ChatGPT or Gemini limit resets while you sleep (say at 5:00 AM), and you want the work to continue before you wake up.

- Works on claude.ai, chatgpt.com and gemini.google.com
- Once or daily, on the days you pick, in any time zone
- Optional follow-up prompts, sent after the previous reply finishes
- Retries while a limit is active, with a time window you control
- Reads the reset time from the site's own limit notice and can set the schedule's time to match
- Catches up if the browser was closed at the scheduled time, within a grace period
- Never sends twice, never overwrites text already in the message box
- No account, no server, no tracking. Everything stays in your browser

## What it cannot do

- It cannot run while Chrome is closed or the computer is asleep. The settings have a keep-awake option, and the pre-sleep checklist walks you through it.
- It can only read a reset time while the site is showing a limit notice. With no limit active there is nothing to read.
- It cannot get around a usage limit. It sends the prompt when the site lets you send it.
- It is not affiliated with Anthropic, OpenAI or Google. Check each service's terms before you automate anything.

## Install from source

```bash
node scripts/build.mjs
```

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `dist/extension`. The Chrome Web Store zip is written to `dist/promptalarm-<version>.zip`.

## How it works

- Manifest V3 with a module service worker. The worker keeps no state in memory and rebuilds from `chrome.storage.local` every time it wakes up.
- Each schedule is a Chrome alarm. A 15-minute reconcile alarm recomputes what is due from the clock, so a missed or delayed alarm cannot lose a run.
- A run is a small state machine saved after every step: open the tab, check the page, send, wait for the reply. A send intent is saved before sending, so a restart checks the page instead of sending again.
- A script is injected into the chat tab on demand. Each site has an adapter that only says where the message box and send button are. The behavior is shared.
- The site permissions are optional and requested when you save a schedule.

Code layout:

```
extension/background   service worker: scheduler, run state machine, messages, alarms
extension/content      injected runner, shared helpers, one locator file per site
extension/core         time zone maths, validation, prompt templates
extension/ui           popup and options page (no framework, no innerHTML)
extension/shared       provider list, reason texts
scripts                build, icons, store images
test                   unit tests, mock chat site, end-to-end tests
```

## Tests

```bash
npm install
npx playwright install chromium
npm run test:unit      # time zones, validation, limit detection
npm run test:e2e       # loads the extension in Chromium against a mock chat site
npm run store-assets   # release smoke test and Chrome Web Store images
```

The end-to-end tests use a mock chat site that behaves like the real ones in the ways that matter here: a rich-text message box, a send button that stays disabled while empty, streaming replies, usage-limit banners, a login page and slow loading. The test build adds the mock site; the release build does not contain it.

## Selectors can break

The real chat sites change their pages without notice. Each adapter in `extension/content/adapters/` lists where to find the message box, the send button and the reply, and has a `lastVerified` field. When a site changes, fix the locators in that one file. The "Check this page" button in the popup tells you whether the adapter still finds everything. Adapter fixes are the most useful contribution.

## Contributing

Issues and pull requests are welcome. Please run both test commands before you open a pull request, and keep the extension free of network calls.

## License

MIT. See [LICENSE](LICENSE). Privacy policy: [PRIVACY.md](PRIVACY.md).
