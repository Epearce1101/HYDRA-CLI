import fs from 'node:fs';
import { append_entry } from './hydra-file.js';
import { detectConnectedHeads } from './heads.js';
import { withLock } from './lock.js';
import { getProjectPaths, readProjectConfig, updateProjectConfig } from './project.js';

export const tokenCosts = Object.freeze({
  claude: Object.freeze({
    default: 0.0015,
    models: Object.freeze({
      'claude-opus-4-1-20250805': 0.015,
      'claude-opus-4-20250514': 0.015,
      'claude-sonnet-4-20250514': 0.003,
      'claude-3-7-sonnet-20250219': 0.003,
      'claude-3-5-sonnet-20241022': 0.0015,
      'claude-3-opus-20240229': 0.015,
      'claude-3-haiku-20240307': 0.0005,
      'claude-3-5-haiku-20241022': 0.0008,
    }),
  }),
  codex: Object.freeze({
    default: 0.015,
    models: Object.freeze({
      'gpt-5.5': 0.005,
      'gpt-5.4': 0.0025,
      'gpt-5.4-mini': 0.00075,
      'gpt-5.4-nano': 0.00025,
      'gpt-5': 0.00125,
      'gpt-4o': 0.015,
      'o1-mini': 0.03,
      'o1-preview': 0.06,
      o3: 0.002,
    }),
  }),
  gemini: Object.freeze({
    default: 0.0005,
    models: Object.freeze({
      'gemini-3-pro-preview': 0.002,
      'gemini-2.5-pro': 0.0015,
      'gemini-1.5-flash': 0.0005,
      'gemini-1.5-pro': 0.0015,
      'gemini-2.5-flash': 0.0005,
      'gemini-2.5-flash-lite': 0.0005,
    }),
  }),
});

const HEAD_ORDER = ['claude', 'codex', 'gemini'];

export function estimateCost(tokens, head, model) {
  const pricing = tokenCosts[head] || { default: 0, models: {} };
  const costPerK = pricing.models[model] || pricing.default;
  return (tokens * costPerK) / 1000;
}

export function parseBudgetAmount(input) {
  const match = String(input || '').match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function getBudgetState(root = process.cwd()) {
  return {
    config: readProjectConfig(root).budget,
    usage: readBudgetUsage(root),
  };
}

export async function enableBudget(limitUsd, root = process.cwd()) {
  updateProjectConfig((config) => {
    config.budget.enabled = true;
    config.budget.limit_usd = limitUsd;
    return config;
  }, root);
  await append_entry('BUDGET LOG', 'budget', `Budget ON  limit ${formatUsd(limitUsd)}`, root);
}

export async function disableBudget(root = process.cwd()) {
  updateProjectConfig((config) => {
    config.budget.enabled = false;
    return config;
  }, root);
  await append_entry('BUDGET LOG', 'budget', 'Budget OFF', root);
}

export async function addBudget(amountUsd, root = process.cwd()) {
  const current = readProjectConfig(root).budget;
  const currentLimit = Number(current.limit_usd || 0);
  const nextLimit = currentLimit + amountUsd;
  updateProjectConfig((config) => {
    config.budget.enabled = true;
    config.budget.limit_usd = nextLimit;
    return config;
  }, root);
  await append_entry('BUDGET LOG', 'budget', `User extended budget to ${formatUsd(nextLimit)}`, root);
  return nextLimit;
}

export async function setBudgetLimit(amountUsd, root = process.cwd()) {
  updateProjectConfig((config) => {
    config.budget.enabled = true;
    config.budget.limit_usd = amountUsd;
    return config;
  }, root);
  await append_entry('BUDGET LOG', 'budget', `User set budget to ${formatUsd(amountUsd)}`, root);
}

export async function setBudgetAlert(percent, root = process.cwd()) {
  updateProjectConfig((config) => {
    config.budget.alert_at_pct = percent;
    return config;
  }, root);
  await append_entry('BUDGET LOG', 'budget', `Alert threshold set to ${percent}%`, root);
}

export async function resetBudget(root = process.cwd()) {
  await withLock(getBudgetLockPath(root), async () => {
    writeBudgetUsage(defaultBudgetUsage(), root);
  });
  await append_entry('BUDGET LOG', 'budget', 'Budget usage reset', root);
}

export async function recordBudgetUsage({ head, model, tokens, root = process.cwd() }) {
  const safeTokens = Number(tokens) > 0 ? Number(tokens) : 0;
  const cost = estimateCost(safeTokens, head, model);

  const usage = await withLock(getBudgetLockPath(root), async () => {
    const current = readBudgetUsage(root);
    current.perHead[head] = Number(current.perHead[head] || 0) + cost;
    current.perHeadTokens[head] = Number(current.perHeadTokens[head] || 0) + safeTokens;
    current.total = HEAD_ORDER.reduce((sum, headId) => sum + Number(current.perHead[headId] || 0), 0);
    writeBudgetUsage(current, root);
    return current;
  });

  await append_entry('BUDGET LOG', 'budget', budgetUsageLogLine(usage), root);
  return { usage, cost };
}

export function shouldPauseHead(headId, root = process.cwd()) {
  const { config, usage } = getBudgetState(root);
  return Boolean(config.enabled && usage.pausedHeads.includes(headId));
}

export async function pauseMeteredHeads(headIds, root = process.cwd()) {
  await withLock(getBudgetLockPath(root), async () => {
    const usage = readBudgetUsage(root);
    usage.pausedHeads = Array.from(new Set([...usage.pausedHeads, ...headIds]));
    writeBudgetUsage(usage, root);
  });
}

export async function resumeAllHeads(root = process.cwd()) {
  await withLock(getBudgetLockPath(root), async () => {
    const usage = readBudgetUsage(root);
    usage.pausedHeads = [];
    writeBudgetUsage(usage, root);
  });
}

export function budgetThreshold(root = process.cwd()) {
  const { config, usage } = getBudgetState(root);
  if (!config.enabled || !config.limit_usd) {
    return { state: 'off', pct: 0 };
  }

  const pct = (usage.total / config.limit_usd) * 100;
  if (usage.total >= config.limit_usd) {
    return { state: 'limit', pct };
  }
  if (pct >= config.alert_at_pct) {
    return { state: 'alert', pct };
  }

  return { state: 'ok', pct };
}

export function formatBudgetDisplay({ root = process.cwd(), includeCommands = true } = {}) {
  const { config, usage } = getBudgetState(root);
  const heads = detectConnectedHeads();
  if (!config.enabled) {
    return formatBudgetOff(config, usage, heads, includeCommands);
  }

  return formatBudgetOn(config, usage, heads, includeCommands);
}

export function formatBudgetDoctorLine(root = process.cwd()) {
  const { config, usage } = getBudgetState(root);
  if (!config.enabled) {
    return 'Budget: OFF';
  }

  return `Budget: ON  ${formatUsd(usage.total)} of ${formatUsd(config.limit_usd || 0)}`;
}

export function formatBudgetAlert(root = process.cwd()) {
  const { config, usage } = getBudgetState(root);
  const alertAt = Number(config.alert_at_pct || 80);
  return `🟡 [HYDRA] Budget alert  ${alertAt}% spent
Estimated: ${formatUsd((config.limit_usd || 0) * (alertAt / 100))} of ${formatUsd(config.limit_usd || 0)}
Remaining: ~${formatUsd(Math.max(0, (config.limit_usd || 0) - usage.total))}
  [C]  Continue       Keep working, alert again at 90%
  [X]  Extend         Add more budget now
  [P]  Pause API      Pause metered heads, continue others
  [O]  Budget OFF     Remove limit entirely`;
}

export function formatBudgetLimitReached(root = process.cwd()) {
  const { config, usage } = getBudgetState(root);
  const lines = [
    `🔴 [HYDRA] Budget limit reached  ${formatUsd(config.limit_usd || 0)}`,
    'Metered heads have been paused.',
  ];

  for (const head of detectConnectedHeads()) {
    const spent = usage.perHead[head.id] || 0;
    const active = usage.pausedHeads.includes(head.id) ? 'Paused' : 'Active';
    const estimate = active === 'Active' && spent === 0
      ? '(non-metered or subscription)'
      : `~${formatUsd(spent)}`;
    lines.push(`${head.tag.padEnd(10)} ${active.padEnd(9)} ${estimate}`);
  }

  lines.push('  [X]  Extend         Add more budget and continue');
  lines.push('  [S]  Sub only       Continue with non-metered heads only');
  lines.push('  [O]  Budget OFF     Remove limit, resume all heads');
  lines.push('  [E]  End session');
  return lines.join('\n');
}

export function formatExtendBudgetPrompt(root = process.cwd()) {
  const { config, usage } = getBudgetState(root);
  return `🔴 [HYDRA] Extend budget
Current limit:    ${formatUsd(config.limit_usd || 0)}
Estimated spent:  ${formatUsd(usage.total)}
New total limit: $ _
Enter total new limit (not the amount to add)
Example: 10.00 sets new limit to $10.00`;
}

export function extractResponseTokens(response) {
  const usage = response?.usage || {};
  const candidates = [
    usage.totalTokens,
    usage.total_tokens,
    usage.totalTokenCount,
    sumIfNumbers(usage.inputTokens, usage.outputTokens),
    sumIfNumbers(usage.promptTokenCount, usage.candidatesTokenCount),
    response?.estimatedTokens,
  ];

  return Number(candidates.find((candidate) => Number.isFinite(Number(candidate)) && Number(candidate) > 0) || 0);
}

export function formatUsd(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function readBudgetUsage(root) {
  const paths = getProjectPaths(root);
  if (!fs.existsSync(paths.budgetSessionFile)) {
    writeBudgetUsage(defaultBudgetUsage(), root);
  }

  return normalizeBudgetUsage(JSON.parse(fs.readFileSync(paths.budgetSessionFile, 'utf8')));
}

function getBudgetLockPath(root) {
  return `${getProjectPaths(root).budgetSessionFile}.lock`;
}

function writeBudgetUsage(usage, root) {
  const paths = getProjectPaths(root);
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.writeFileSync(paths.budgetSessionFile, `${JSON.stringify(normalizeBudgetUsage(usage), null, 2)}\n`, 'utf8');
}

function defaultBudgetUsage() {
  return {
    total: 0,
    perHead: { claude: 0, codex: 0, gemini: 0 },
    perHeadTokens: { claude: 0, codex: 0, gemini: 0 },
    pausedHeads: [],
  };
}

function normalizeBudgetUsage(usage) {
  const defaults = defaultBudgetUsage();
  return {
    ...defaults,
    ...usage,
    perHead: { ...defaults.perHead, ...(usage.perHead || {}) },
    perHeadTokens: { ...defaults.perHeadTokens, ...(usage.perHeadTokens || {}) },
    pausedHeads: Array.isArray(usage.pausedHeads) ? usage.pausedHeads : [],
    total: Number(usage.total || 0),
  };
}

function budgetUsageLogLine(usage) {
  return `Claude ~${formatUsd(usage.perHead.claude)} | Codex ~${formatUsd(usage.perHead.codex)} | Total ~${formatUsd(usage.total)}`;
}

function formatBudgetOn(config, usage, heads, includeCommands) {
  const limit = Number(config.limit_usd || 0);
  const remaining = Math.max(0, limit - usage.total);
  const lines = [
    '🔴 [HYDRA] BUDGET',
    '',
    'Status:      ON',
    `Limit:       ${formatUsd(limit)}`,
    `Estimated:   ${formatUsd(usage.total)}`,
    `Remaining:   ${formatUsd(remaining)}`,
    `Alert at:    ${config.alert_at_pct}% (${formatUsd(limit * (Number(config.alert_at_pct || 80) / 100))})`,
    ...formatHeadBudgetLines(heads, usage, false),
  ];

  if (includeCommands) {
    lines.push('');
    lines.push('/hydra budget OFF              Disable');
    lines.push('/hydra budget add --$5.00      Add funds');
  }

  return lines.join('\n');
}

function formatBudgetOff(config, usage, heads, includeCommands) {
  const lines = [
    '🔴 [HYDRA] BUDGET',
    '',
    'Status:    OFF',
    'Tracking:  Disabled',
    ...formatHeadBudgetLines(heads, usage, true),
  ];

  if (includeCommands) {
    lines.push('');
    lines.push('/hydra budget ON--$5.00    Enable with limit');
  }

  return lines.join('\n');
}

function formatHeadBudgetLines(heads, usage, untracked) {
  return heads.map((head) => {
    const status = head.authMode === 'subscription'
      ? 'Subscription'
      : head.connected ? (head.id === 'gemini' ? 'Connected' : 'API Key') : 'No key';
    const spent = usage.perHead[head.id] || 0;
    const estimate = head.authMode === 'subscription'
      ? 'unmetered'
      : spent > 0
      ? `~${formatUsd(spent)}${untracked ? ' this session (untracked)' : ''}`
      : 'usage estimate unavailable';
    return `${head.tag.padEnd(9)} ${status.padEnd(10)} ${estimate}`;
  });
}

function sumIfNumbers(left, right) {
  if (!Number.isFinite(Number(left)) || !Number.isFinite(Number(right))) {
    return null;
  }

  return Number(left) + Number(right);
}
