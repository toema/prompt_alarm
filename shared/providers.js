// Supported chat sites. Used by the service worker and the UI.
// Content-script adapters live in content/adapters/ and repeat the host list;
// test/unit/providers.test.mjs checks the two stay in sync.

export const PROVIDERS = {
  claude: {
    id: 'claude',
    name: 'Claude',
    hosts: ['claude.ai'],
    origins: ['https://claude.ai/*'],
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    origins: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    hosts: ['gemini.google.com'],
    origins: ['https://gemini.google.com/*'],
  },
  
};

// Scripts injected into a chat tab when a run starts, in order.
export const ADAPTER_FILES = [
  'content/sdk.js',
  'content/adapters/claude.js',
  'content/adapters/chatgpt.js',
  'content/adapters/gemini.js',
  
  'content/runner.js',
];

export function providerForUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  for (const p of Object.values(PROVIDERS)) {
    if (p.hosts.includes(u.hostname)) return p;
  }
  return null;
}

export function supportedNames() {
  return Object.values(PROVIDERS)
    .filter((p) => !p.allowHttp)
    .map((p) => p.name)
    .join(', ');
}

export function normalizeTargetUrl(input) {
  let u;
  try {
    u = new URL(String(input ?? '').trim());
  } catch {
    return { ok: false, error: 'That is not a valid link.' };
  }
  const provider = providerForUrl(u.href);
  if (!provider) {
    return { ok: false, error: `Unsupported site. Supported: ${supportedNames()}.` };
  }
  if (u.protocol !== 'https:' && !(provider.allowHttp && u.protocol === 'http:')) {
    return { ok: false, error: 'Use the secure https:// link of the chat.' };
  }
  u.hash = '';
  return { ok: true, url: u.href, provider: provider.id };
}

function chatKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function sameChatUrl(a, b) {
  const ka = chatKey(a);
  return ka !== '' && ka === chatKey(b);
}
