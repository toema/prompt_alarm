// Gemini (gemini.google.com) locators. Best-effort, see claude.js for the policy.
(function (root) {
  'use strict';
  const S = root.__PA_SDK;
  if (!S || !root.__PA_ADAPTERS) return;

  root.__PA_ADAPTERS.push({
    id: 'gemini',
    hosts: ['gemini.google.com'],
    lastVerified: null,
    matches(host) {
      return this.hosts.includes(host);
    },
    conversationSelectors: ['user-query', 'model-response', 'message-content', '.query-text', '.response-container'],
    isSignedOut() {
      if (/^\/(signin|login)/.test(location.pathname)) return true;
      const signIn = S.firstVisible(['a[href*="accounts.google.com/ServiceLogin"]', 'a[href*="accounts.google.com/signin"]']);
      return !!signIn && !this.getComposer();
    },
    getComposer() {
      return S.firstVisible([
        'rich-textarea div.ql-editor[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][role="textbox"][aria-label*="prompt" i]',
        'div[contenteditable="true"][role="textbox"]',
        'textarea[aria-label*="prompt" i]',
      ]);
    },
    getSendButton() {
      return S.firstVisible([
        'button[aria-label="Send message"]',
        'button.send-button',
        'button[aria-label*="Send" i]',
      ]);
    },
    isGenerating() {
      return !!S.firstVisible(['button[aria-label="Stop response"]', 'button.stop', 'button[aria-label*="Stop" i]']);
    },
    userMessages() {
      return S.allOfFirst(['user-query', '.user-query-bubble-with-background', '.query-text']);
    },
    assistantMessages() {
      return S.allOfFirst(['model-response', 'message-content', '.model-response-text']);
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
