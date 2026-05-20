import fs from 'node:fs';
import { detectSubscriptionBinary } from './adapters/subscription-base.js';
import { getProjectPaths, readProjectConfig } from './project.js';

const SUBSCRIPTION_BINARY_BY_HEAD = Object.freeze({
  claude: 'claude',
  codex: 'codex',
});

function resolveSubscriptionBinary(headId, env) {
  if (headId === 'claude') {
    return env.HYDRA_CLAUDE_BIN || SUBSCRIPTION_BINARY_BY_HEAD.claude;
  }
  if (headId === 'codex') {
    return env.HYDRA_CODEX_BIN || SUBSCRIPTION_BINARY_BY_HEAD.codex;
  }
  return null;
}

export const COLOR_PALETTE = Object.freeze([
  'orange', 'white', 'blue', 'purple', 'green', 'yellow', 'red', 'cyan', 'pink', 'teal',
]);

const BUILTIN_HEADS = Object.freeze([
  Object.freeze({
    id: 'claude',
    name: 'Claude',
    tag: '[CLAUDE]',
    providerId: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    defaultRole: 'reasoning, architecture, code review, security, tradeoffs, long-form analysis',
    aliases: ['head1'],
    color: 'orange',
    baseUrl: null,
    builtin: true,
  }),
  Object.freeze({
    id: 'codex',
    name: 'Codex',
    tag: '[CODEX]',
    providerId: 'openai',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    defaultRole: 'code generation, debugging, implementation, tests, edits, fast iteration',
    aliases: ['head2'],
    color: 'white',
    baseUrl: null,
    builtin: true,
  }),
  Object.freeze({
    id: 'gemini',
    name: 'Gemini',
    tag: '[GEMINI]',
    providerId: 'google-gemini',
    envKey: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-2.5-flash-lite',
    defaultRole: 'research, broad comparison, documentation, large-context review, web-grounded responses',
    aliases: ['head3'],
    color: 'blue',
    baseUrl: null,
    builtin: true,
  }),
]);

export const HEAD_CAP_DEFAULT = 5;

let registryCache = null;

function defaultBuiltinsForSeed() {
  return BUILTIN_HEADS.map((head) => ({ ...head }));
}

function readHeadsFile(root = process.cwd()) {
  const paths = getProjectPaths(root);
  try {
    if (!fs.existsSync(paths.headsFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(paths.headsFile, 'utf8'));
    if (!parsed || !Array.isArray(parsed.heads)) return null;
    return parsed.heads;
  } catch {
    return null;
  }
}

function writeHeadsFile(heads, root = process.cwd()) {
  const paths = getProjectPaths(root);
  try {
    fs.mkdirSync(paths.stateDir, { recursive: true });
    fs.writeFileSync(paths.headsFile, JSON.stringify({ heads }, null, 2), 'utf8');
  } catch {
    // best-effort
  }
}

function normalizeHead(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const id = raw.id.toLowerCase();
  const builtin = BUILTIN_HEADS.find((h) => h.id === id);
  return {
    id,
    name: raw.name || builtin?.name || id.charAt(0).toUpperCase() + id.slice(1),
    tag: raw.tag || builtin?.tag || `[${id.toUpperCase()}]`,
    providerId: raw.providerId || raw.provider || builtin?.providerId || null,
    envKey: raw.envKey || raw.env_key || builtin?.envKey || null,
    defaultModel: raw.defaultModel || raw.default_model || builtin?.defaultModel || null,
    defaultRole: raw.defaultRole || raw.default_role || builtin?.defaultRole || null,
    aliases: normalizeHeadAliases(raw.aliases ?? raw.nicknames ?? raw.nickname ?? builtin?.aliases ?? []),
    color: raw.color || builtin?.color || nextPaletteColor([]),
    baseUrl: raw.baseUrl ?? raw.base_url ?? builtin?.baseUrl ?? null,
    builtin: Boolean(builtin),
  };
}

function nextPaletteColor(existing) {
  const used = new Set(existing.map((h) => h.color));
  for (const color of COLOR_PALETTE) {
    if (!used.has(color)) return color;
  }
  return COLOR_PALETTE[existing.length % COLOR_PALETTE.length];
}

function normalizeHeadAliases(rawAliases) {
  const values = Array.isArray(rawAliases) ? rawAliases : [rawAliases];
  return Array.from(new Set(values
    .flatMap((value) => String(value || '').split(','))
    .filter((value) => value.trim())
    .map((value) => value.trim().toLowerCase().replace(/^\/+/, ''))));
}

function loadHeadsRegistry(root = process.cwd()) {
  if (registryCache) return registryCache;

  const fromFile = readHeadsFile(root);
  if (fromFile) {
    const normalized = fromFile.map(normalizeHead).filter((head) => head !== null);
    const { heads, changed } = applyHeadSlotColors(normalized);
    if (changed) {
      writeHeadsFile(heads, root);
    }
    registryCache = heads;
    return registryCache;
  }

  // Seed file with built-ins on first read
  const seeded = defaultBuiltinsForSeed();
  writeHeadsFile(seeded, root);
  registryCache = seeded;
  return registryCache;
}

function applyHeadSlotColors(heads) {
  let changed = false;
  const result = heads.map((head, index) => {
    const color = COLOR_PALETTE[index % COLOR_PALETTE.length];
    if (head.color === color) {
      return { ...head };
    }
    changed = true;
    return { ...head, color };
  });
  return { heads: result, changed };
}

export function refreshHeadsRegistry() {
  registryCache = null;
}

export function getHeadCap(env = process.env) {
  const explicit = Number(env.HYDRA_HEAD_CAP);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return HEAD_CAP_DEFAULT;
}

export function headsMap(root = process.cwd()) {
  const arr = loadHeadsRegistry(root);
  return Object.fromEntries(arr.map((h) => [h.id, h]));
}

export function getHead(id, root = process.cwd()) {
  if (!id) return null;
  return headsMap(root)[String(id).toLowerCase()] || null;
}

export function listHeads(root = process.cwd()) {
  return loadHeadsRegistry(root).map((h) => ({ ...h }));
}

export function addHeadToRegistry(head, root = process.cwd()) {
  const current = loadHeadsRegistry(root);
  if (current.some((h) => h.id === head.id)) {
    throw new Error(`Head "${head.id}" already exists.`);
  }
  const normalized = normalizeHead({
    ...head,
    color: head.color || nextPaletteColor(current),
  });
  if (!normalized) {
    throw new Error('Invalid head definition.');
  }
  const { heads: next } = applyHeadSlotColors([...current, normalized]);
  writeHeadsFile(next, root);
  registryCache = next;
  return next.find((candidate) => candidate.id === normalized.id) || normalized;
}

export function removeHeadFromRegistry(id, root = process.cwd()) {
  const current = loadHeadsRegistry(root);
  const { heads: next } = applyHeadSlotColors(current.filter((h) => h.id !== id.toLowerCase()));
  if (next.length === current.length) return false;
  writeHeadsFile(next, root);
  registryCache = next;
  return true;
}

export function updateHeadInRegistry(id, patch, root = process.cwd()) {
  const current = loadHeadsRegistry(root);
  const index = current.findIndex((h) => h.id === id.toLowerCase());
  if (index === -1) return null;
  const merged = normalizeHead({ ...current[index], ...patch });
  if (!merged) return null;
  const next = [...current];
  next[index] = merged;
  const { heads: recolored } = applyHeadSlotColors(next);
  writeHeadsFile(recolored, root);
  registryCache = recolored;
  return recolored[index] || merged;
}

export function resolveHeads(requestedHeads, root = process.cwd()) {
  const all = listHeads(root);
  if (!requestedHeads || requestedHeads.length === 0 || requestedHeads.includes('all')) {
    return all;
  }

  const resolved = [];
  for (const requested of requestedHeads) {
    const id = String(requested).toLowerCase();
    const head = all.find((h) => h.id === id);
    if (!head) {
      const known = all.map((h) => h.id).join(', ');
      throw new Error(`Unknown head "${requested}". Expected ${known}, or all.`);
    }
    resolved.push(head);
  }

  return resolved;
}

export function findHeadsByRole(roleTag, env = process.env, root = process.cwd()) {
  const target = String(roleTag || '').trim().toLowerCase();
  if (!target) return [];
  return detectConnectedHeads(env, root).filter((head) => {
    const role = String(head.role || '').trim().toLowerCase();
    return role === target;
  });
}

export function detectConnectedHeads(env = process.env, root = process.cwd()) {
  const config = readProjectConfig(root);
  const auth = config.auth || {};
  const models = config.models || {};
  const roles = config.roles || {};
  const prompts = config.prompts || {};
  const agreementAccepted = Boolean(config.subscription_agreement?.accepted);
  return listHeads(root).map((head) => ({
    ...head,
    ...resolveHeadConnection(head, auth[head.id] || 'auto', env, { agreementAccepted }),
    model: models[head.id] || (head.envKey ? env[`${head.envKey.replace('_API_KEY', '')}_MODEL`] : null) || head.defaultModel,
    role: roles[head.id] || null,
    prompt: prompts[head.id] || null,
  }));
}

export function normalizeAuthMode(mode) {
  const normalized = String(mode || 'auto').toLowerCase();
  if (normalized === 'api' || normalized === 'api_key') {
    return 'api-key';
  }
  if (normalized === 'sub' || normalized === 'subscription') {
    return 'subscription';
  }
  if (normalized === 'none' || normalized === 'off') {
    return 'off';
  }
  if (normalized === 'api-key') {
    return 'api-key';
  }
  return 'auto';
}

function resolveHeadConnection(head, configuredMode, env, options = {}) {
  const mode = normalizeAuthMode(configuredMode);
  const hasApiKey = head.envKey ? Boolean(env[head.envKey]) : false;
  const { agreementAccepted = false } = options;

  if (mode === 'off') {
    return {
      authMode: 'off',
      connected: false,
      callable: false,
      metered: false,
      connectionLabel: 'OFF',
      subscriptionReason: null,
      subscriptionBinary: null,
    };
  }

  if (mode === 'subscription') {
    const binary = resolveSubscriptionBinary(head.id, env);
    let binaryAvailable = false;
    let binaryDetail = null;
    if (binary) {
      const detection = detectSubscriptionBinary(binary);
      binaryAvailable = detection.available;
      binaryDetail = detection.available ? detection.version : detection.error;
    }

    let subscriptionReason;
    if (!agreementAccepted) {
      subscriptionReason = 'awaiting_agreement';
    } else if (!binary) {
      subscriptionReason = 'no_binary_for_head';
    } else if (!binaryAvailable) {
      subscriptionReason = 'binary_missing';
    } else {
      subscriptionReason = 'ready';
    }

    const callable = subscriptionReason === 'ready';
    return {
      authMode: 'subscription',
      connected: true,
      callable,
      metered: false,
      connectionLabel: 'SUBSCRIPTION',
      subscriptionReason,
      subscriptionBinary: binary,
      subscriptionBinaryDetail: binaryDetail,
    };
  }

  if (mode === 'api-key' || hasApiKey) {
    return {
      authMode: 'api-key',
      connected: hasApiKey,
      callable: hasApiKey,
      metered: true,
      connectionLabel: hasApiKey ? 'API KEY' : 'API KEY MISSING',
      subscriptionReason: null,
      subscriptionBinary: null,
    };
  }

  return {
    authMode: 'auto',
    connected: false,
    callable: false,
    metered: true,
    connectionLabel: 'NOT FOUND',
    subscriptionReason: null,
    subscriptionBinary: null,
  };
}
