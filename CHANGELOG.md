# Changelog

## 1.1.0

- "Read the reset time from the site" in the schedule editor: opens the chat link in the background, reads the time from the usage-limit notice and fills in the schedule's time (zone-aware, with a minutes-after-reset buffer).
- Optional "Keep this time in step with the site's reset time" for repeating schedules: when a run finds the limit active and the page states a reset time, the time of day moves to match for the following days. The run in progress is not duplicated.
- The reset-time reader understands "resets 5am" and a named time zone such as "(Africa/Cairo)".

## 1.0.0

First release.

- Schedule a prompt for a chat link on Claude, ChatGPT or Gemini: once, or daily on the days you choose, in any time zone.
- Optional follow-up prompts, sent after the previous reply finishes.
- Retries while a usage limit is active, using the reset time shown on the page as a hint.
- Catch-up for runs missed while the browser was closed, within a grace period you set. Older ones are recorded as missed.
- Protection against sending twice, and against overwriting text already in the message box.
- Pause switch, run history with plain-language reasons, pre-sleep checklist, "Check this page" self-test.
- Optional keep-awake and notifications, requested only when turned on.
- Export and import of schedules. No account, no server, no tracking.
