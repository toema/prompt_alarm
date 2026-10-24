// Claude (claude.ai) locators. Best-effort: selectors are ordered from the most stable
// (accessibility labels, test ids) to structural fallbacks. lastVerified stays null until
// the maintainers re-check them on the live site; use "Check this page" in the extension.
(function (root) {
  'use strict';
  const S = root.__PA_SDK;
  if (!S || !root.__PA_ADAPTERS) return;

  root.__PA_ADAPTERS.push({
    id: 'claude',
    hosts: ['claude.ai'],
    lastVerified: null,
    matches(host) {
      return this.hosts.includes(host);
    },
    conversationSelectors: [
      '[data-testid="user-message"]',
      '.font-claude-message',
      '.font-claude-response',
      '[data-is-streaming]',
    ],
    isSignedOut() {
      if (/^\/(login|logout|signup)/.test(location.pathname)) return true;
      const loginUi = S.firstVisible(['[data-testid="login-button"]', 'button[data-testid*="google" i]']);
      return !!loginUi && !this.getComposer();
    },
    getComposer() {
      return S.firstVisible([
        '[data-testid="chat-input"][contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"][aria-label*="prompt" i]',
        'div.ProseMirror[contenteditable="true"]',
        'fieldset div[contenteditable="true"]',
        'textarea[placeholder]',
      ]);
    },
    getSendButton() {
      return S.firstVisible([
        'button[aria-label="Send message"]',
        'button[aria-label="Send Message"]',
        'fieldset button[aria-label*="Send" i]',
        'fieldset button[type="submit"]',
      ]);
    },
    isGenerating() {
      return !!S.firstVisible(['button[aria-label="Stop response"]', 'button[aria-label="Stop Response"]', 'fieldset button[aria-label*="Stop" i]']);
    },
    userMessages() {
      return S.allOfFirst(['[data-testid="user-message"]']);
    },
    assistantMessages() {
      return S.allOfFirst(['.font-claude-response', '.font-claude-message', '[data-is-streaming]']);
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
