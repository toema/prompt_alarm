// ChatGPT (chatgpt.com, chat.openai.com) locators. Best-effort, see claude.js for the policy.
(function (root) {
  'use strict';
  const S = root.__PA_SDK;
  if (!S || !root.__PA_ADAPTERS) return;

  root.__PA_ADAPTERS.push({
    id: 'chatgpt',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    lastVerified: null,
    matches(host) {
      return this.hosts.includes(host);
    },
    conversationSelectors: [
      '[data-message-author-role]',
      'article[data-testid^="conversation-turn"]',
      '[data-testid^="conversation-turn"]',
    ],
    isSignedOut() {
      if (/^\/(auth|login)/.test(location.pathname)) return true;
      return !!S.firstVisible(['[data-testid="login-button"]', '[data-testid="signup-button"]']);
    },
    getComposer() {
      return S.firstVisible([
        '#prompt-textarea[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"][id="prompt-textarea"]',
        'textarea#prompt-textarea',
        'textarea[name="prompt-textarea"]',
        'form div[contenteditable="true"][role="textbox"]',
        'form div.ProseMirror[contenteditable="true"]',
      ]);
    },
    getSendButton() {
      return S.firstVisible([
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'form button[aria-label*="Send" i]',
        'form button[type="submit"]',
      ]);
    },
    isGenerating() {
      return !!S.firstVisible(['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]', 'form button[aria-label*="Stop" i]']);
    },
    userMessages() {
      return S.allOfFirst(['[data-message-author-role="user"]']);
    },
    assistantMessages() {
      return S.allOfFirst(['[data-message-author-role="assistant"]']);
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
