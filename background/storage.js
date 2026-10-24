// Local storage layer. Only the service worker writes; pages read storage directly and
// ask the worker to change anything (see messages.js). Everything stays on this device.

export const DEFAULT_SETTINGS = {
  paused: false,
  keepAwake: false,
  notifications: false,
  logRetentionDays: 30,
  lastSeenAt: 0,
  schemaVersion: 1,
};

const KEYS = ['settings', 'schedules', 'runs'];
const ACTIVE = new Set(['queued', 'running', 'blocked']);

export const isActive = (run) => ACTIVE.has(run.status);

let chain = Promise.resolve();

/** Runs tasks one at a time so read-modify-write never interleaves. */
export function serial(fn) {
  const p = chain.then(fn);
  chain = p.then(
    () => {},
    () => {}
  );
  return p;
}

export async function load() {
  const d = await chrome.storage.local.get(KEYS);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    schedules: Array.isArray(d.schedules) ? d.schedules : [],
    runs: Array.isArray(d.runs) ? d.runs : [],
  };
}

/** Read-modify-write. `fn(data)` edits data in place and may return a value. Do not call mutate inside fn. */
export function mutate(fn) {
  return serial(async () => {
    const data = await load();
    const before = {};
    for (const k of KEYS) before[k] = JSON.stringify(data[k]);
    const out = await fn(data);
    const patch = {};
    for (const k of KEYS) if (JSON.stringify(data[k]) !== before[k]) patch[k] = data[k];
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    return out;
  });
}

export async function getRun(id) {
  const { runs } = await load();
  return runs.find((r) => r.id === id) || null;
}

/** Newest first. Active runs are never dropped. */
export function pruneRuns(data) {
  const cutoff = Date.now() - data.settings.logRetentionDays * 86400000;
  const active = data.runs.filter(isActive);
  const done = data.runs.filter((r) => !isActive(r) && (r.endedAt ?? r.createdAt ?? 0) >= cutoff);
  data.runs = [...active, ...done].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 500);
}

export async function migrate() {
  await mutate((data) => {
    if (!data.settings.schemaVersion) data.settings.schemaVersion = 1;
  });
}
