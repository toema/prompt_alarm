# Chrome Web Store listing: copy and paste

Upload `promptalarm-1.1.0.zip` in the Developer Dashboard, then fill in the fields below.
Check each field against the live form before you submit, because Google changes the dashboard from time to time.

## Store listing tab

**Name** (from the package, shown automatically)
PromptAlarm: Scheduled Prompts for AI Chat

**Summary** (from the package, 132 characters maximum)
Schedule a prompt for your AI chat and retry until your usage limit resets. Local only, no account, no tracking.

**Category**
Productivity

**Language**
English

**Description**

```
Your Claude, ChatGPT or Gemini usage limit resets while you sleep. PromptAlarm makes sure your work is waiting when you wake up.

Pick a chat, a time and a prompt. At that time PromptAlarm opens the chat link, types your prompt and presses send, the way you would. If your usage limit is still active, it tries again until the limit resets.

WHAT YOU CAN DO
• Send a prompt once, or every day on the days you choose, in any time zone
• Add follow-up prompts, sent after the previous reply finishes
• Retry while a usage limit is active, with an interval and a time window you control
• Read the reset time from the site's own limit notice and set your schedule's time to match, once or automatically
• Catch up if the browser was closed at the scheduled time, within a grace period you set
• Pause everything with one switch
• See a plain-language history: sent, not sent and why, or missed
• Export your schedules to a file and import them on another computer

BUILT TO BE SAFE
• Never sends twice: a run is saved after every step, so a restart checks the page before sending again
• Never overwrites text you already typed in the message box
• Stops and tells you if you are signed out or the page looks different than expected
• Asks for access only to the chat sites you use, only when you save a schedule or read its reset time
• Notifications and keep-awake are optional and requested only when you turn them on

PRIVATE BY DESIGN
No account. No server. No analytics. Your schedules and history stay in your browser. PromptAlarm does not read or store the replies you receive. It is open source, so you can check every line.

GOOD TO KNOW
• Chrome must be open and the computer awake at the scheduled time. A pre-sleep checklist and an optional keep-awake setting help with that.
• PromptAlarm cannot get around a usage limit. It sends your prompt when the site lets you send it.
• Chat websites change often. If a site changes and PromptAlarm cannot find the message box, it tells you instead of guessing, and a "Check this page" button shows what works.
• The reset time can only be read while the site is showing a usage-limit notice.
• Supported sites: claude.ai, chatgpt.com (and chat.openai.com), gemini.google.com

PromptAlarm is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic, OpenAI or Google. Claude, ChatGPT and Gemini are trademarks of their owners. Check each service's terms of use before you automate anything.
```

**Graphic assets** (in `store/images/`)
- Icon: 128x128, already inside the package (`icons/icon128.png`). The dashboard also asks for it on this tab, so upload `extension/icons/icon128.png`.
- Screenshots (1280x800): `1-schedules`, `2-editor`, `3-history`, `4-settings`, `5-popup`
- Small promo tile: `promo-small-440x280.png`
- Marquee promo tile: `promo-marquee-1400x560.png` (optional)

**Official URL / Homepage URL / Support URL**
`https://github.com/toema/prompt_alarm`
Support URL: `https://github.com/toema/prompt_alarm/issues` (support email: m.toema20@gmail.com)

## Privacy tab

**Single purpose description**
```
PromptAlarm sends a prompt that the user wrote to a chat page that the user chose, at a time that the user chose, and retries while the site's usage limit is active.
```

**Permission justifications**

`alarms`
```
Runs the user's schedules at the chosen time, and runs retries and a periodic catch-up check, because the extension's background worker is not kept running.
```

`storage`
```
Saves the user's schedules, settings and run history on their own computer (chrome.storage.local). Nothing is sent anywhere.
```

`scripting`
```
Injects the extension's own bundled script into the chat tab the user approved, to find the message box, type the user's prompt and press send. No remotely hosted code is used.
```

`activeTab`
```
Lets the toolbar popup read the address of the tab the user has open, so it can offer to schedule that chat, and run the "Check this page" test when the user presses it.
```

Optional host permissions (`https://claude.ai/*`, `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://gemini.google.com/*`)
```
These are the chat sites PromptAlarm can type into. They are optional and requested at runtime, one site at a time, when the user saves a schedule for that site. Without access to a site the extension does nothing there.
```

Optional permission `notifications`
```
Used only if the user turns on notifications, to show a desktop notice when a scheduled run finishes or fails.
```

Optional permission `power`
```
Used only if the user turns on "Keep the computer awake", to stop the computer from sleeping shortly before a scheduled run, because a sleeping computer cannot send the prompt.
```

**Remote code**
No, I am not using remote code. (All code is inside the package. No `eval`, no remote scripts.)

**Data usage**
PromptAlarm does not collect user data: nothing is transmitted off the device, and there are no analytics. The schedules and prompts the user writes stay in local storage. Leave every data-type checkbox unchecked, then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

If the form's current wording makes you unsure whether text stored only on the device counts as "collected", the policy at `PRIVACY.md` describes exactly what is stored and where.

**Privacy policy URL**
Push this repository to GitHub first so the file is public, then use:
`https://github.com/toema/prompt_alarm/blob/main/PRIVACY.md`

## Distribution tab

- Visibility: Public (or Unlisted for a first trial with friends)
- Regions: all regions
- Pricing: free

## Notes for the reviewer (Test instructions field)

```
PromptAlarm needs an account on one of the supported chat sites (claude.ai, chatgpt.com or gemini.google.com) to send a prompt. The interface can be reviewed without any account.

To test:
1. Click the toolbar icon, then "New schedule" (or open the extension's options page).
2. Enter a chat link, for example https://claude.ai/new, and choose a time one minute from now.
3. Write a short prompt such as "Say hello" and press Save. Chrome asks for access to that one site. Allow it.
4. At the chosen time the extension opens the chat, types the prompt and presses send. You can also press "Run now" on the schedule.
5. The History tab shows the result in plain words. If you are not signed in, it records "Not sent: signed out" and does nothing else.

The extension makes no network requests of its own. All data stays in chrome.storage.local.
```

## Before you press "Submit for review"

1. Check the name "PromptAlarm" is free in the store and as a trademark, or rename it in `extension/_locales/en/messages.json` and rebuild.
2. Replace the two placeholders in `PRIVACY.md` and publish it at a public URL.
3. A one-time developer registration fee applies to a new Chrome Web Store developer account.
4. Try the extension yourself on the real sites first (see the README, "Selectors can break").
