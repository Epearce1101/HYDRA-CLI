import { BUILTIN_COMMANDS, ROLE_COMMANDS, getNicknameEntries } from './command-registry.js';
import { listHeads } from './heads.js';
import { HEAD_ROLES, MODEL_ALIASES } from './provider-commands.js';

function currentHeadIds() {
  return listHeads().map((h) => h.id);
}

const ROLE_IDS = Object.keys(HEAD_ROLES);

const SHORTHAND_COMMANDS = Object.freeze([
  ...Object.keys(BUILTIN_COMMANDS).map((command) => `/${command}`),
  ...Object.keys(ROLE_COMMANDS).map((command) => `/${command}`),
  ...Object.values(ROLE_COMMANDS).map((command) => `/${command.name} "prompt"`),
  '/advise',
  '/advise "prompt"',
  '/wf',
  '/wf on',
  '/wf off',
  '/wf status',
  '/lead',
  '/lead none',
]);

const BASE_COMMANDS = Object.freeze([
  '/menu',
  '/dashboard',
  '/dash',
  '/hydra help',
  '/hydra commands',
  '/hydra complete',
  '/hydra status',
  '/hydra setup',
  '/remove head',
  '/hydra doctor',
  '/hydra heads',
  '/hydra roles',
  '/roles clear all',
  '/hydra roles clear all',
  '/hydra nicknames',
  '/hydra who advisor',
  '/hydra models',
  '/hydra accounts',
  '/hydra providers',
  '/hydra resume',
  '/hydra clear',
  '/hydra compact',
  '/hydra fork',
  '/hydra side',
  '/hydra head',
  '/hydra head list',
  '/hydra head add',
  '/hydra head edit',
  '/hydra head remove',
  '/hydra head test',
  '/hydra native',
  '/hydra native claude',
  '/hydra native claude --help',
  '/hydra native claude doctor',
  '/hydra native claude mcp list',
  '/hydra native codex',
  '/hydra native codex --help',
  '/hydra native codex exec --help',
  '/hydra native codex mcp list',
  '/hydra claude-code --help',
  '/hydra codex-cli --help',
  '/hydra config',
  '/hydra config set logo full',
  '/hydra config set logo compact',
  '/hydra config set logo off',
  '/hydra auth',
  '/hydra auth clear --force',
  '/hydra all',
  '/hydra advisor',
  '/hydra advisor opus',
  '/hydra advisor opus47',
  '/hydra advisor sonnet',
  '/hydra advisor haiku',
  '/hydra advise',
  '/hydra workflow',
  '/hydra workflow on',
  '/hydra workflow off',
  '/hydra workflow status',
  '/hydra mode auto',
  '/hydra mode workflow',
  '/hydra mode parallel',
  '/hydra lead',
  '/hydra lead none',
  '/hydra memory',
  '/hydra memory add',
  '/hydra memory clear --force',
  '/hydra budget',
  '/hydra budget ON--$5.00',
  '/hydra budget OFF',
  '/hydra budget status',
  '/hydra budget add --$2.00',
  '/hydra budget set --$10.00',
  '/hydra budget reset',
  '/hydra budget alert 80',
  '/hydra decide',
  '/hydra decide history',
  '/hydra decide revisit',
  '/hydra permissions',
  '/hydra permissions strict',
  '/hydra permissions default',
  '/hydra permissions trust',
  '/hydra permissions full',
  '/hydra permissions reset',
  '/hydra permissions-all',
  '/hydra permissions-all --save',
  '/hydra allow writes 10m',
  '/hydra allow writes this-session',
  '/hydra allow path ./src',
  '/hydra allow command',
  '/hydra deny shell',
  '/hydra exit',
]);

export function hydraCompleter(line) {
  const value = String(line || '');
  if (!value.toLowerCase().startsWith('/')) {
    return [[], value];
  }

  const hits = commandSuggestions(value);
  const candidates = completionCandidates(value);
  return [hits.length ? hits : candidates, value];
}

export function commandSuggestions(line, limit = Infinity) {
  const value = String(line || '');
  const normalizedValue = value.toLowerCase();
  if (!normalizedValue.startsWith('/')) {
    return [];
  }

  return completionCandidates(value)
    .filter((candidate) => candidate.toLowerCase().startsWith(normalizedValue))
    .slice(0, limit);
}

export function isCompleteCommand(line) {
  const value = String(line || '').trim().toLowerCase();
  if (!value.startsWith('/')) {
    return false;
  }

  return completionCandidates(value)
    .some((candidate) => candidate.toLowerCase() === value);
}

export function completionCandidates(line = '') {
  return Array.from(new Set([
    ...SHORTHAND_COMMANDS,
    ...BASE_COMMANDS,
    ...nicknameCommands(),
    ...headCommands(),
    ...setupHeadCommands(),
    ...removeHeadCommands(),
    ...contextCommands(),
    ...authCommands(),
    ...roleClearCommands(),
    ...leadCommands(),
    ...modeCommands(),
    ...providerRoleCommands(line),
    ...hydraRoleCommands(),
  ])).sort();
}

function nicknameCommands() {
  return getNicknameEntries(listHeads())
    .filter((entry) => !entry.reserved)
    .map((entry) => `/${entry.alias}`);
}

function headCommands() {
  return currentHeadIds().flatMap((headId) => [
    `/${headId}`,
    `/hydra ${headId}`,
  ]);
}

function setupHeadCommands() {
  const slots = currentHeadIds().map((_, index) => index + 1);
  return [
    ...slots.flatMap((slot) => [
      `/setup head ${slot}`,
      `/hydra setup head ${slot}`,
    ]),
    '/setup head new',
    '/hydra setup head new',
  ];
}

function removeHeadCommands() {
  const slots = currentHeadIds().map((_, index) => index + 1);
  return slots.flatMap((slot) => [
    `/remove head ${slot}`,
    `/hydra head remove head ${slot}`,
  ]);
}

function contextCommands() {
  return currentHeadIds().flatMap((headId) => currentHeadIds()
    .filter((otherHeadId) => otherHeadId !== headId)
    .map((otherHeadId) => `/hydra ${headId} --with ${otherHeadId}`));
}

function authCommands() {
  return currentHeadIds().flatMap((headId) => [
    `/hydra auth ${headId} auto`,
    `/hydra auth ${headId} api-key`,
    `/hydra auth ${headId} subscription`,
    `/hydra auth ${headId} off`,
  ]);
}

function roleClearCommands() {
  return [
    '/roles clear all',
    '/hydra roles clear all',
    ...currentHeadIds().flatMap((_headId, index) => [
      `/roles clear head ${index + 1}`,
      `/hydra roles clear head ${index + 1}`,
    ]),
  ];
}

function leadCommands() {
  return currentHeadIds().flatMap((headId) => [
    `/lead ${headId}`,
    `/hydra lead ${headId}`,
  ]);
}

function modeCommands() {
  return currentHeadIds().map((headId) => `/hydra mode solo ${headId}`);
}

function hydraRoleCommands() {
  return Object.keys(ROLE_COMMANDS).flatMap((command) => [
    `/hydra ${command}`,
    `/hydra ${command} "prompt"`,
  ]);
}

function providerRoleCommands(line) {
  const tokens = line.trim().toLowerCase().split(/\s+/);
  const maybeHead = tokens[1];
  const selectedHeads = currentHeadIds().includes(maybeHead) ? [maybeHead] : currentHeadIds();

  return selectedHeads.flatMap((headId) => {
    const models = Object.keys(MODEL_ALIASES[headId] || {});
    const roleOnly = ROLE_IDS.map((role) => `/hydra ${headId} ${role}`);
    const modelOnly = models.map((model) => `/hydra ${headId} ${model}`);
    const roleAndModel = ROLE_IDS.flatMap((role) => models.map((model) => `/hydra ${headId} ${role} ${model}`));
    return [
      ...roleOnly,
      ...modelOnly,
      ...roleAndModel,
    ];
  });
}
