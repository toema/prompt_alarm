// Stable reason codes -> plain language. Run logs store only the code.

export const REASONS = {
  LIMIT_ACTIVE: 'The usage limit was still active, so the message was not accepted.',
  LIMIT_REACHED_MID_RUN: 'The limit was reached while running; remaining steps were not sent.',
  SIGNED_OUT: 'The chat redirected away or showed a sign-in page. Sign in and run it again.',
  ADAPTER_OUTDATED: 'The message box was not found. The site may have changed; update the extension.',
  DRAFT_PRESENT: 'The message box already had unsent text, so nothing was sent.',
  OFFLINE: 'The chat page did not load. Check the internet connection.',
  TAB_UNREACHABLE: 'The chat tab could not be controlled (closed, crashed, or blocked).',
  ACCESS_REVOKED: 'Access to the chat site was removed. Open PromptAlarm and re-approve it.',
  WRONG_PAGE: 'The tab was not on the chat link.',
  SEND_FAILED: 'The message could not be confirmed as sent.',
  REPLY_TIMEOUT: 'Sent, but the reply did not finish within the time limit.',
  NO_REPLY_DETECTED: 'Sent, but no reply was detected afterwards.',
  REPLY_ERROR: 'Sent, but the site showed an error instead of a reply.',
  CAP_REACHED: 'The per-run message cap stopped the remaining steps.',
  PAUSED: 'PromptAlarm was paused.',
  MISSED_WINDOW: 'The browser was not running in time, and the grace period passed.',
  PREVIOUS_RUN_ACTIVE: 'The previous run of this schedule was still active.',
  SCHEDULE_DELETED: 'The schedule was deleted while this run was active.',
  UNSUPPORTED_SITE: 'This site is not supported.',
  CANCELLED: 'Cancelled by you.',
  RUNNER_ERROR: 'The page script failed unexpectedly.',
  INTERNAL_ERROR: 'An unexpected error happened.',
};

export function reasonText(code) {
  return REASONS[code] || (code ? String(code) : '');
}
