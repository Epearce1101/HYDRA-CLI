import fs from 'node:fs';
import path from 'node:path';
import { defaultHydraFile, SHARED_FILE } from './hydra-file.js';

export const HYDRA_STATE_DIR = '.hydra-state';
export { SHARED_FILE };

export function getProjectPaths(root = process.cwd()) {
  return {
    root,
    stateDir: path.join(root, HYDRA_STATE_DIR),
    sharedFile: path.join(root, SHARED_FILE),
    tasksLog: path.join(root, HYDRA_STATE_DIR, 'tasks.log'),
    budgetSessionFile: path.join(root, HYDRA_STATE_DIR, 'budget-session.json'),
    configFile: path.join(root, HYDRA_STATE_DIR, 'config.yaml'),
    legacyConfigFile: path.join(root, HYDRA_STATE_DIR, 'config.json'),
    headsFile: path.join(root, HYDRA_STATE_DIR, 'heads.json'),
    artifactsDir: path.join(root, HYDRA_STATE_DIR, 'artifacts'),
    deliverablesDir: path.join(root, '.hydra-artifacts'),
  };
}

export function ensureProjectState(root = process.cwd()) {
  const paths = getProjectPaths(root);
  fs.mkdirSync(paths.stateDir, { recursive: true });

  if (!fs.existsSync(paths.sharedFile)) {
    fs.writeFileSync(paths.sharedFile, defaultHydraFile(), 'utf8');
  }

  if (!fs.existsSync(paths.configFile)) {
    const initialConfig = fs.existsSync(paths.legacyConfigFile)
      ? normalizeConfig(JSON.parse(fs.readFileSync(paths.legacyConfigFile, 'utf8')))
      : defaultConfig();
    fs.writeFileSync(paths.configFile, serializeProjectConfig(initialConfig), 'utf8');
  }

  return paths;
}

export function readProjectConfig(root = process.cwd()) {
  const paths = ensureProjectState(root);
  return normalizeConfig(parseProjectConfig(fs.readFileSync(paths.configFile, 'utf8')));
}

export function writeProjectConfig(config, root = process.cwd()) {
  const paths = ensureProjectState(root);
  fs.writeFileSync(paths.configFile, serializeProjectConfig(normalizeConfig(config)), 'utf8');
}

export function updateProjectConfig(updater, root = process.cwd()) {
  const current = readProjectConfig(root);
  const next = updater(structuredClone(current)) || current;
  writeProjectConfig(next, root);
  return readProjectConfig(root);
}

export function writeTaskLog(event, root = process.cwd()) {
  const paths = ensureProjectState(root);
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...event,
  });
  fs.appendFileSync(paths.tasksLog, `${line}\n`, 'utf8');
}

function defaultConfig() {
  return {
    logo: 'full',
    mode: {
      type: 'auto',
      head: null,
    },
    permissions: {
      default_level: 1,
      always_confirm_nuke: true,
      always_confirm_clear_all_memory: true,
      always_confirm_remove_head: true,
      always_confirm_destructive_shell: true,
    },
    auth: {
      claude: 'auto',
      codex: 'auto',
      gemini: 'auto',
    },
    models: {
      claude: null,
      codex: null,
      gemini: null,
    },
    roles: {
      claude: null,
      codex: null,
      gemini: null,
    },
    prompts: {
      claude: null,
      codex: null,
      gemini: null,
    },
    budget: {
      enabled: false,
      limit_usd: null,
      alert_at_pct: 80,
      reset_on_session_start: false,
      exclude_subscription_heads: true,
      at_limit_action: 'pause',
    },
    workflow: {
      enabled: false,
      chat_head: 'gemini',
      code_head: 'codex',
      code_role: 'code',
      advisor_head: 'claude',
      advisor_role: 'advisor',
      advisor_model: 'claude-opus-4-7',
    },
    orchestration: {
      enabled: false,
      decision_policy: 'recommend',
      worker_roles: ['code', 'debug', 'test', 'review', 'architect', 'research', 'verify'],
      judge_role: 'judge',
      advisor_role: 'advisor',
      ask_user_on: ['low_confidence', 'subjective_tradeoff', 'missing_required_role'],
    },
    subscription_agreement: {
      accepted: false,
      accepted_at: null,
    },
  };
}

function normalizeConfig(config) {
  const defaults = defaultConfig();
  const permissionDefaultLevel = Number(
    config.permissions?.default_level ?? legacyPermissionLevel(config.permissions?.profile) ?? defaults.permissions.default_level,
  );
  const budgetLimit = config.budget?.limit_usd ?? config.budget?.dailyLimitUsd ?? defaults.budget.limit_usd;
  const budgetAlert = config.budget?.alert_at_pct ?? config.budget?.warnAtPercent ?? defaults.budget.alert_at_pct;

  return {
    ...defaults,
    ...config,
    mode: {
      ...defaults.mode,
      ...(config.mode || {}),
    },
    permissions: {
      ...defaults.permissions,
      ...(config.permissions || {}),
      default_level: Number.isInteger(permissionDefaultLevel) ? permissionDefaultLevel : defaults.permissions.default_level,
    },
    auth: {
      ...defaults.auth,
      ...(config.auth || {}),
    },
    models: {
      ...defaults.models,
      ...(config.models || {}),
    },
    roles: {
      ...defaults.roles,
      ...(config.roles || {}),
    },
    prompts: {
      ...defaults.prompts,
      ...(config.prompts || {}),
    },
    budget: {
      ...defaults.budget,
      ...(config.budget || {}),
      limit_usd: budgetLimit === null ? null : Number(budgetLimit),
      alert_at_pct: Number(budgetAlert),
      enabled: Boolean(config.budget?.enabled ?? defaults.budget.enabled),
    },
    workflow: {
      ...defaults.workflow,
      ...(config.workflow || {}),
      enabled: Boolean(config.workflow?.enabled ?? defaults.workflow.enabled),
    },
    orchestration: {
      ...defaults.orchestration,
      ...(config.orchestration || {}),
      enabled: Boolean(config.orchestration?.enabled ?? defaults.orchestration.enabled),
      worker_roles: Array.isArray(config.orchestration?.worker_roles)
        ? config.orchestration.worker_roles
        : defaults.orchestration.worker_roles,
      ask_user_on: Array.isArray(config.orchestration?.ask_user_on)
        ? config.orchestration.ask_user_on
        : defaults.orchestration.ask_user_on,
    },
    subscription_agreement: {
      ...defaults.subscription_agreement,
      ...(config.subscription_agreement || {}),
      accepted: Boolean(
        config.subscription_agreement?.accepted ?? defaults.subscription_agreement.accepted,
      ),
    },
  };
}

function legacyPermissionLevel(profile) {
  if (profile === 'strict') {
    return 0;
  }
  if (profile === 'default') {
    return 1;
  }
  if (profile === 'trust') {
    return 2;
  }
  if (profile === 'full') {
    return 3;
  }
  return null;
}

function parseProjectConfig(text) {
  const config = {};
  let currentSection = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) {
      continue;
    }

    const topLevelMatch = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/);
    if (topLevelMatch) {
      const [, key, value] = topLevelMatch;
      if (value === undefined || value === '') {
        config[key] = {};
        currentSection = key;
      } else {
        config[key] = parseScalar(value);
        currentSection = null;
      }
      continue;
    }

    const nestedMatch = rawLine.match(/^\s{2}([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (nestedMatch && currentSection) {
      const [, key, value = ''] = nestedMatch;
      config[currentSection][key] = parseScalar(value);
    }
  }

  return config;
}

function serializeProjectConfig(config) {
  return [
    `logo: ${config.logo}`,
    'mode:',
    `  type: ${config.mode.type}`,
    `  head: ${config.mode.head ?? 'null'}`,
    'permissions:',
    `  default_level: ${config.permissions.default_level}`,
    `  always_confirm_nuke: ${config.permissions.always_confirm_nuke}`,
    `  always_confirm_clear_all_memory: ${config.permissions.always_confirm_clear_all_memory}`,
    `  always_confirm_remove_head: ${config.permissions.always_confirm_remove_head}`,
    `  always_confirm_destructive_shell: ${config.permissions.always_confirm_destructive_shell}`,
    ...serializeMapSection('auth', config.auth, ['claude', 'codex', 'gemini']),
    ...serializeMapSection('models', config.models, ['claude', 'codex', 'gemini']),
    ...serializeMapSection('roles', config.roles, ['claude', 'codex', 'gemini']),
    ...serializeMapSection('prompts', config.prompts, ['claude', 'codex', 'gemini']),
    'budget:',
    `  enabled: ${config.budget.enabled}`,
    `  limit_usd: ${config.budget.limit_usd ?? 'null'}`,
    `  alert_at_pct: ${config.budget.alert_at_pct}`,
    `  reset_on_session_start: ${config.budget.reset_on_session_start}`,
    `  exclude_subscription_heads: ${config.budget.exclude_subscription_heads}`,
    `  at_limit_action: ${config.budget.at_limit_action}`,
    'workflow:',
    `  enabled: ${config.workflow.enabled}`,
    `  chat_head: ${config.workflow.chat_head}`,
    `  code_head: ${config.workflow.code_head}`,
    `  code_role: ${config.workflow.code_role}`,
    `  advisor_head: ${config.workflow.advisor_head}`,
    `  advisor_role: ${config.workflow.advisor_role}`,
    `  advisor_model: ${config.workflow.advisor_model}`,
    'orchestration:',
    `  enabled: ${config.orchestration.enabled}`,
    `  decision_policy: ${config.orchestration.decision_policy}`,
    `  judge_role: ${config.orchestration.judge_role}`,
    `  advisor_role: ${config.orchestration.advisor_role}`,
    `  worker_roles: [${config.orchestration.worker_roles.map((r) => JSON.stringify(r)).join(', ')}]`,
    `  ask_user_on: [${config.orchestration.ask_user_on.map((r) => JSON.stringify(r)).join(', ')}]`,
    'subscription_agreement:',
    `  accepted: ${config.subscription_agreement.accepted}`,
    `  accepted_at: ${config.subscription_agreement.accepted_at ?? 'null'}`,
    '',
  ].join('\n');
}

function serializeMapSection(name, values = {}, preferredKeys = []) {
  const keys = [
    ...preferredKeys.filter((key) => Object.hasOwn(values, key)),
    ...Object.keys(values)
      .filter((key) => !preferredKeys.includes(key))
      .sort(),
  ];
  return [
    `${name}:`,
    ...keys.map((key) => `  ${key}: ${formatScalar(values[key])}`),
  ];
}

function formatScalar(value) {
  if (value === null || value === undefined || value === '') {
    return 'null';
  }
  return String(value);
}

function parseScalar(value) {
  const trimmed = String(value).trim();
  if (trimmed === 'null' || trimmed === '') {
    return null;
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const body = trimmed.slice(1, -1).trim();
    if (!body) return [];
    return body
      .split(',')
      .map((item) => item.trim())
      .map((item) => item.replace(/^["'](.*)["']$/, '$1'))
      .filter(Boolean);
  }

  const number = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(number)) {
    return number;
  }

  return trimmed;
}
