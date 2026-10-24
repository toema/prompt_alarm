# PromptAlarm Privacy Policy

_Last updated: 23 October 2026_

PromptAlarm is a browser extension that sends a prompt you wrote to a chat page you chose, at a time you chose. It is open source and works entirely inside your browser.

## The short version

- PromptAlarm has **no server, no account and no analytics**. It does not send any data to its developers or to any third party.
- Everything it keeps stays in your browser's local extension storage on your computer.
- It does not read, copy or store the replies you receive.

## What PromptAlarm stores on your computer

This data is saved with `chrome.storage.local` and never leaves your device:

- Your schedules: name, chat link, time, days, time zone, the prompt text you wrote, and retry settings.
- A history of runs: when each run was due, whether it was sent, and the reason if it was not, plus the time of each attempt. History does not include your prompts or any replies. It is deleted automatically after the number of days you choose (30 by default), and you can clear it at any time.
- Your settings, such as the pause switch, keep-awake and notifications.

You can export your schedules to a file, import them back, or delete them in the extension at any time. Removing the extension deletes everything it stored.

## What PromptAlarm does on chat websites

When a run is due, PromptAlarm opens your chat link, and then:

- It looks at the page to find the message box and the send button, and to check whether you are signed in.
- It checks the page for a usage-limit notice. The text of that notice is used in the page only to decide whether to wait and retry. It is not saved or sent anywhere. If you use "Read the reset time from the site", or turn on "Keep this time in step with the site's reset time", the reset time found in that notice is turned into a time of day and saved in your schedule. The notice text itself is still not stored.
- It types your prompt into the message box and presses send, the way you would.
- If you chose to wait for the reply, it watches whether the reply is still being written. It measures only whether the reply is still changing, not what it says.

PromptAlarm only acts on the chat sites you approve (claude.ai, chatgpt.com, chat.openai.com and gemini.google.com). Chrome asks for your permission for each site when you save a schedule or read its reset time, and you can remove that permission at any time in Chrome's extension settings.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `alarms` | Wake the extension at the scheduled time and for retries. |
| `storage` | Keep your schedules, history and settings on your computer. |
| `scripting` | Add the small script that types the prompt into the chat page you approved. |
| `activeTab` | Let the popup read the address of the tab you have open, so it can offer to schedule that chat or check it when you press "Check this page". |
| Site access (optional) | Needed only for the chat sites you approve, so the extension can type into them. |
| `notifications` (optional) | Only if you turn on notifications. |
| `power` (optional) | Only if you turn on "Keep the computer awake". |

## Third parties and chat services

The chat services you use (for example Anthropic, OpenAI or Google) receive your prompt in the same way as if you had typed it yourself, and their own privacy policies apply to that. PromptAlarm is not affiliated with, endorsed by or sponsored by any of them.

## Children

PromptAlarm does not collect personal information from anyone, including children.

## Changes

If this policy changes, the new version will be published in the project repository with a new date at the top, and the extension's release notes will say so.

## Contact

Questions or concerns: open an issue in the project repository at https://github.com/toema/prompt_alarm/issues or write to m.toema20@gmail.com.
