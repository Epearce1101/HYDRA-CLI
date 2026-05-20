import fs from 'node:fs';
import path from 'node:path';
import { HYDRA_STATE_DIR } from './project.js';
import { createHeadAdapter } from './adapters/index.js';

const TTL_MS = 5 * 60 * 1000;

function healthFile(root) {
  return path.join(root, HYDRA_STATE_DIR, 'health.json');
}

function readHealth(root) {
  try {
    const raw = fs.readFileSync(healthFile(root), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeHealth(data, root) {
  try {
    fs.writeFileSync(healthFile(root), JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // best-effort; cache is non-critical
  }
}

export function getHealth(headId, root = process.cwd()) {
  const entry = readHealth(root)[headId];
  if (!entry || !entry.at) {
    return { verified: false, fresh: false, error: null, at: null };
  }
  const ageMs = Date.now() - new Date(entry.at).getTime();
  const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs < TTL_MS;
  return {
    verified: Boolean(entry.verified) && fresh,
    fresh,
    error: entry.error || null,
    at: entry.at,
  };
}

export function setHealth(headId, result, root = process.cwd()) {
  const data = readHealth(root);
  data[headId] = {
    verified: Boolean(result.verified),
    error: result.error || null,
    at: new Date().toISOString(),
  };
  writeHealth(data, root);
}

export function invalidateHealth(root = process.cwd()) {
  try {
    fs.unlinkSync(healthFile(root));
  } catch {
    // ignore — file may not exist
  }
}

export async function verifyHead(head, { timeoutMs = 20000, root = process.cwd() } = {}) {
  if (!head.callable) {
    setHealth(head.id, { verified: false, error: 'not callable' }, root);
    return { verified: false, error: 'not callable' };
  }

  try {
    const adapter = createHeadAdapter(head);
    let timedOut = false;
    const ok = await Promise.race([
      adapter.connect(),
      new Promise((resolve) => setTimeout(() => {
        timedOut = true;
        resolve(false);
      }, timeoutMs)),
    ]);
    const error = ok
      ? null
      : (timedOut
        ? `timed out after ${timeoutMs}ms`
        : (adapter.lastConnectionError || 'verify failed'));
    setHealth(head.id, { verified: ok, error }, root);
    return { verified: Boolean(ok), error };
  } catch (error) {
    const message = String(error?.message || error);
    setHealth(head.id, { verified: false, error: message }, root);
    return { verified: false, error: message };
  }
}
