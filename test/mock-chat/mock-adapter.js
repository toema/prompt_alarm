// Test-only adapter for the mock chat site (copied into the test build by scripts/build.mjs).
(function (root) {
  'use strict';
  const S = root.__PA_SDK;
  if (!S || !root.__PA_ADAPTERS) return;

  root.__PA_ADAPTERS.push({
    id: 'mock',
    hosts: ['localhost', '127.0.0.1'],
    lastVerified: 'test',
    matches(host) {
      return this.hosts.includes(host);
    },
    conversationSelectors: ['.msg'],
    isSignedOut() {
      return location.pathname.startsWith('/login');
    },
    getComposer() {
      return S.firstVisible(['#composer']);
    },
    getSendButton() {
      return S.firstVisible(['#send']);
    },
    isGenerating() {
      return !!S.firstVisible(['#stop']);
    },
    userMessages() {
      return S.allOfFirst(['.msg.user']);
    },
    assistantMessages() {
      return S.allOfFirst(['.msg.assistant']);
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
