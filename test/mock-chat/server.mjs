// A small fake chat site used by the end-to-end tests. It behaves like the real sites in the
// ways PromptAlarm cares about: a rich-text message box, a send button that is disabled while
// empty, streaming replies with a stop button, usage-limit banners, a login page, and slow hydration.
//
// Control it with: POST /__set {limit, warn, nopaste, replyMs, signedOut}, GET /__log, POST /__reset

import http from 'node:http';

const state = { limit: false, warn: false, nopaste: false, replyMs: 1200, signedOut: false };
let events = [];

const page = (id, query) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock chat ${id}</title>
<style>
  body{font:15px system-ui;margin:0;display:flex;flex-direction:column;height:100vh}
  #thread{flex:1;overflow:auto;padding:16px}
  .msg{margin:8px 0;padding:8px 12px;border-radius:8px;max-width:70%;white-space:pre-wrap}
  .msg.user{background:#dde;margin-left:auto}.msg.assistant{background:#eee}
  .composer{display:flex;gap:8px;padding:12px;border-top:1px solid #ccc}
  #composer{flex:1;min-height:40px;border:1px solid #999;padding:6px;border-radius:6px}
  .banner{background:#fde;padding:10px 16px}
</style></head><body>
<nav><a href="/chat/other-chat-about-usage-limit-reset-at-5-am">Old chat: usage limit will reset at 5:00 AM</a></nav>
<main id="thread"></main>
<div id="slot"></div>
<div class="composer">
  <div id="composer" contenteditable="true" role="textbox" aria-label="Message"></div>
  <button id="send" aria-label="Send message" disabled>Send</button>
  <button id="stop" aria-label="Stop response" hidden>Stop</button>
</div>
<script>
const CHAT = ${JSON.stringify(id)};
const params = new URLSearchParams(${JSON.stringify(query)});
const thread = document.getElementById('thread');
const composer = document.getElementById('composer');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const slot = document.getElementById('slot');
let st = {};
let busy = false;

function addMsg(role, text){
  const d = document.createElement('div'); d.className = 'msg ' + role; d.setAttribute('data-role', role); d.textContent = text;
  thread.append(d); thread.scrollTop = thread.scrollHeight; return d;
}
function refresh(){
  const hasText = composer.innerText.trim() !== '';
  sendBtn.disabled = !hasText || (st.limit && !st.warn) || busy;
}
async function poll(){
  try { st = await (await fetch('/__state')).json(); } catch(e) { return; }
  const blocked = st.limit && !st.warn;
  composer.contentEditable = blocked ? 'false' : 'true';
  if ((st.limit || st.warn) && !slot.firstChild) {
    const b = document.createElement('div'); b.className = 'banner'; b.setAttribute('role','alert');
    b.textContent = st.warn ? '3 messages left. Your limit will reset at 5:00 AM.' : "You've reached your usage limit. Your limit will reset at 5:00 AM.";
    slot.append(b);
  }
  if (!st.limit && !st.warn) slot.textContent = '';
  refresh();
}
composer.addEventListener('input', refresh);
composer.addEventListener('paste', (e) => {
  if (st.nopaste) return; // behaves like an editor that ignores synthetic paste
  e.preventDefault();
  const t = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, t);
});
composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
sendBtn.addEventListener('click', send);

async function send(){
  const text = composer.innerText.trim();
  if (!text || busy || (st.limit && !st.warn)) return;
  busy = true;
  await fetch('/__msg', { method: 'POST', body: JSON.stringify({ chat: CHAT, text }) });
  addMsg('user', text);
  composer.textContent = '';
  refresh();
  stopBtn.hidden = false;
  const reply = addMsg('assistant', '');
  const full = 'Sure, working on it. ' + 'Here is a reply to: ' + text.slice(0, 40);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await new Promise(r => setTimeout(r, Math.max(10, (st.replyMs || 1200) / steps)));
    reply.textContent = full.slice(0, Math.ceil(full.length * i / steps));
  }
  stopBtn.hidden = true;
  busy = false;
  await fetch('/__done', { method: 'POST', body: JSON.stringify({ chat: CHAT }) });
  refresh();
}

(async () => {
  await poll();
  const seed = Number(params.get('seed') || 0);
  const delay = Number(params.get('hydrate') || 0);
  setTimeout(() => {
    for (let i = 0; i < seed; i++) { addMsg('user', 'earlier question ' + (i+1)); addMsg('assistant', 'earlier answer ' + (i+1)); }
  }, delay);
  setInterval(poll, 400);
})();
</script></body></html>`;

const login = `<!doctype html><html><head><title>Log in</title></head><body><h1>Log in</h1><button>Continue with email</button></body></html>`;

function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export function startMockChat(port = 0) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (obj, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === '/__state') return json(state);
    if (url.pathname === '/__log') return json(events);
    if (url.pathname === '/__set' && req.method === 'POST') {
      Object.assign(state, await body(req));
      return json(state);
    }
    if (url.pathname === '/__reset' && req.method === 'POST') {
      Object.assign(state, { limit: false, warn: false, nopaste: false, replyMs: 1200, signedOut: false });
      events = [];
      return json({ ok: true });
    }
    if (url.pathname === '/__msg' && req.method === 'POST') {
      const b = await body(req);
      if (state.limit && !state.warn) return json({ ok: false }, 429);
      events.push({ type: 'msg', chat: b.chat, text: b.text, at: Date.now() });
      return json({ ok: true });
    }
    if (url.pathname === '/__done' && req.method === 'POST') {
      const b = await body(req);
      events.push({ type: 'reply-done', chat: b.chat, at: Date.now() });
      return json({ ok: true });
    }
    if (url.pathname === '/login') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(login);
    }
    if (url.pathname.startsWith('/chat/')) {
      if (state.signedOut) {
        res.writeHead(302, { location: '/login' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(page(url.pathname.slice(6), url.search));
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startMockChat(Number(process.env.PORT || 4173));
  console.log(`mock chat on http://127.0.0.1:${port}/chat/demo`);
}
