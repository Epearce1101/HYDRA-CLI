import path from 'node:path';
import { append_entry } from './hydra-file.js';
import { readProjectConfig, updateProjectConfig } from './project.js';
import { MENU_BACK, canUseInteractiveMenu, promptMenuChoice } from './menu.js';

export const PERMISSION_LEVELS = Object.freeze({
  0: Object.freeze({
    level: 0,
    key: 'strict',
    name: 'STRICT',
    label: 'LEVEL 0  STRICT',
    readFiles: 'Approval required',
    writeFiles: 'Approval required',
    modifyFiles: 'Approval required',
    executeCode: 'Approval required',
    destructiveActions: 'Always require approval',
  }),
  1: Object.freeze({
    level: 1,
    key: 'default',
    name: 'DEFAULT',
    label: 'LEVEL 1  DEFAULT',
    readFiles: 'No approval needed',
    writeFiles: 'Approval required',
    modifyFiles: 'Approval required',
    executeCode: 'Approval required',
    destructiveActions: 'Always require approval',
  }),
  2: Object.freeze({
    level: 2,
    key: 'trust',
    name: 'TRUST',
    label: 'LEVEL 2  TRUST',
    readFiles: 'No approval needed',
    writeFiles: 'No approval needed',
    modifyFiles: 'No approval needed',
    executeCode: 'Approval required',
    destructiveActions: 'Always require approval',
  }),
  3: Object.freeze({
    level: 3,
    key: 'full',
    name: 'FULL',
    label: 'LEVEL 3  FULL',
    readFiles: 'No approval needed',
    writeFiles: 'No approval needed',
    modifyFiles: 'No approval needed',
    executeCode: 'No approval needed',
    destructiveActions: 'Always require approval',
  }),
});

const sessionState = {
  level: null,
  grants: {
    readsThisSession: false,
    writesThisSession: false,
    writesUntil: null,
    fullAccessPaths: [],
    commandOnce: [],
    denyShell: false,
  },
};

export function getPermissionState(root = process.cwd()) {
  const config = readProjectConfig(root);
  const savedLevel = normalizeLevel(config.permissions.default_level);
  const level = sessionState.level === null ? savedLevel : sessionState.level;
  return {
    level,
    savedLevel,
    definition: PERMISSION_LEVELS[level],
    scope: getPermissionScope(level, savedLevel),
    grants: structuredClone(sessionState.grants),
  };
}

export async function setPermissionLevel(level, { save = false, root = process.cwd() } = {}) {
  const normalized = normalizeLevel(level);
  if (save) {
    updateProjectConfig((config) => {
      config.permissions.default_level = normalized;
      return config;
    }, root);
  }

  sessionState.level = normalized;
  await append_entry('PERMISSIONS LOG', 'user', permissionLogMessage(normalized), root);
  return getPermissionState(root);
}

export async function resetPermissions(root = process.cwd()) {
  updateProjectConfig((config) => {
    config.permissions.default_level = 1;
    return config;
  }, root);
  sessionState.level = 1;
  await append_entry('PERMISSIONS LOG', 'user', 'Returned to LEVEL 1  DEFAULT', root);
  return getPermissionState(root);
}

export function permissionLevelFromInput(input) {
  const normalized = String(input || '').toLowerCase();
  if (normalized === 'strict' || normalized === '0') {
    return 0;
  }
  if (normalized === 'default' || normalized === '1') {
    return 1;
  }
  if (normalized === 'trust' || normalized === '2') {
    return 2;
  }
  if (normalized === 'full' || normalized === '3') {
    return 3;
  }

  return null;
}

export function formatPermissionsStatus(root = process.cwd()) {
  const state = getPermissionState(root);
  const currentKey = state.definition.key;

  return `
[HYDRA] PERMISSIONS

Current level:   ${state.definition.label}
Scope:           ${state.scope}

    Read files          ${state.definition.readFiles}
    Write files         ${state.definition.writeFiles}
    Execute code        ${state.definition.executeCode}
    Modify files        ${state.definition.modifyFiles}
    Destructive actions ${state.definition.destructiveActions}

/hydra permissions strict      LEVEL 0${currentKey === 'strict' ? ' (current)' : ''}
/hydra permissions default     LEVEL 1${currentKey === 'default' ? ' (current)' : ''}
/hydra permissions trust       LEVEL 2${currentKey === 'trust' ? ' (current)' : ''}
/hydra permissions-all         LEVEL 3${currentKey === 'full' ? ' (current)' : ''}
`;
}

export function fullPermissionsPrompt() {
  return `[HYDRA] PERMISSIONS  FULL AUTONOMY

This allows all connected heads to:

   Read any file within project scope
   Write and create files within project scope
   Modify existing files within project scope
   Execute code without asking

Hydra will still always confirm before:
   /hydra nuke
   Budget limit overage
   Removing a connected head
   Clearing all memory with --force
   Destructive shell commands

Scope: This session only
Add --save flag to persist across sessions.
`;
}

export function permanentFullPermissionsPrompt() {
  return `
[HYDRA] Saving full permissions permanently.
This applies to ALL future sessions on this project.`;
}

export function allowWritesFor(minutes) {
  sessionState.grants.writesUntil = Date.now() + minutes * 60 * 1000;
}

export function allowWritesThisSession() {
  sessionState.grants.writesThisSession = true;
}

export function allowReadsThisSession() {
  sessionState.grants.readsThisSession = true;
}

export function allowPath(targetPath, root = process.cwd()) {
  const resolved = path.resolve(root, targetPath);
  if (!isInsideProjectScope(resolved, root)) {
    return false;
  }

  sessionState.grants.fullAccessPaths.push(resolved);
  return true;
}

export function allowCommandOnce(command) {
  sessionState.grants.commandOnce.push(command);
}

export function denyShellExecution() {
  sessionState.grants.denyShell = true;
}

export function canReadFile(filePath, root = process.cwd()) {
  return evaluateFileRead(filePath, root).allowed;
}

export function canWriteFile(filePath, root = process.cwd()) {
  return evaluateFileWrite(filePath, root).allowed;
}

export function canExecuteCommand(command, root = process.cwd()) {
  return evaluateCommandExecution(command, root).allowed;
}

export function evaluateFileRead(filePath, root = process.cwd()) {
  const state = getPermissionState(root);
  if (!isInsideProjectScope(filePath, root)) {
    return permissionDecision(false, true, 'File is outside project scope.');
  }

  if (isInsideAllowedPath(filePath, root) || state.grants.readsThisSession || state.level >= 1) {
    return permissionDecision(true, false, 'Read allowed by current permissions.');
  }

  return permissionDecision(false, true, 'Read requires approval at current permission level.');
}

export function evaluateFileWrite(filePath, root = process.cwd()) {
  const state = getPermissionState(root);
  if (!isInsideProjectScope(filePath, root)) {
    return permissionDecision(false, true, 'File is outside project scope.');
  }

  if (
    isInsideAllowedPath(filePath, root) ||
    state.grants.writesThisSession ||
    Boolean(state.grants.writesUntil && state.grants.writesUntil > Date.now()) ||
    state.level >= 2
  ) {
    return permissionDecision(true, false, 'Write allowed by current permissions.');
  }

  return permissionDecision(false, true, 'Write requires approval at current permission level.');
}

export function evaluateCommandExecution(command, root = process.cwd()) {
  const state = getPermissionState(root);
  if (state.grants.denyShell) {
    return permissionDecision(false, true, 'Shell execution is blocked for this session.');
  }

  if (isDestructiveShellCommand(command)) {
    return permissionDecision(false, true, 'Destructive shell commands always require approval.');
  }

  const commandIndex = sessionState.grants.commandOnce.indexOf(command);
  if (commandIndex !== -1) {
    sessionState.grants.commandOnce.splice(commandIndex, 1);
    return permissionDecision(true, false, 'Command allowed once by scoped grant.');
  }

  if (state.level >= 3) {
    return permissionDecision(true, false, 'Command allowed by current permissions.');
  }

  return permissionDecision(false, true, 'Command execution requires approval at current permission level.');
}

export async function promptForFileWrite({ head, action, file, size, preview, ask }) {
  console.log(` [HYDRA] [${head}] wants to write a file:

  Action:  ${action}
  File:    ${file}
  Size:    ${size}
  Preview: ${preview}
`);
  return permissionMenu(ask, 'File write permission', [
    ['y', 'Allow this write'],
    ['n', 'Deny this write'],
    ['a', 'Allow all writes this session'],
  ]);
}

export async function promptForFileRead({ head, file, ask }) {
  console.log(` [HYDRA] [${head}] wants to read a file:

  File:    ${file}
`);
  return permissionMenu(ask, 'File read permission', [
    ['y', 'Allow this read'],
    ['n', 'Deny this read'],
    ['a', 'Allow all reads this session'],
  ]);
}

export async function approveFileReadRequest({ head, file, ask }) {
  const answer = (await promptForFileRead({ head, file, ask })).trim().toLowerCase();
  if (answer === 'a') {
    allowReadsThisSession();
    return true;
  }

  return answer === 'y';
}

export async function approveFileWriteRequest({ head, action, file, size, preview, ask }) {
  const answer = (await promptForFileWrite({ head, action, file, size, preview, ask })).trim().toLowerCase();
  if (answer === 'a') {
    allowWritesThisSession();
    return true;
  }

  return answer === 'y';
}

export async function promptForCommand({ head, command, cwd, ask }) {
  const destructive = isDestructiveShellCommand(command) ? '\n  WARNING: This command looks destructive.' : '';
  console.log(` [HYDRA] [${head}] wants to run a shell command:

  Command: ${command}
  Cwd:     ${cwd}${destructive}
`);
  return permissionMenu(ask, 'Command permission', [
    ['y', 'Allow this command once'],
    ['n', 'Deny this command'],
    ['d', 'Deny all shell execution for this session'],
  ]);
}

async function permissionMenu(ask, title, choices) {
  if (!canUseInteractiveMenu()) {
    for (const [key, label] of choices) {
      console.log(`  [${key.toUpperCase()}] ${label}`);
    }
    return ask('Choice: ');
  }

  const index = await promptMenuChoice(ask, title, choices.map(([, label]) => label), 1);
  if (index === MENU_BACK || index === null) {
    return 'n';
  }
  return choices[index]?.[0] || 'n';
}

export async function approveCommandExecutionRequest({ head, command, cwd, ask }) {
  const answer = (await promptForCommand({ head, command, cwd, ask })).trim().toLowerCase();
  if (answer === 'd') {
    denyShellExecution();
    return false;
  }

  return answer === 'y';
}

export function isDestructiveShellCommand(command) {
  const normalized = String(command || '').trim().toLowerCase();
  const destructivePatterns = [
    /^rm\s+.*(-r|-f|--recursive|--force)/,
    /^del\s+/,
    /^erase\s+/,
    /^rmdir\s+/,
    /^remove-item\s+.*(-recurse|-force)/,
    /^git\s+reset\s+--hard/,
    /^git\s+clean\s+.*(-f|--force)/,
    /^format\s+/,
  ];

  return destructivePatterns.some((pattern) => pattern.test(normalized));
}

function getPermissionScope(level, savedLevel) {
  if (sessionState.level !== null) {
    return 'This session only';
  }

  if (savedLevel !== 1 && level === savedLevel) {
    return 'Saved to config';
  }

  return 'This session only';
}

function normalizeLevel(level) {
  const parsed = Number(level);
  if (!Number.isInteger(parsed) || !PERMISSION_LEVELS[parsed]) {
    return 1;
  }

  return parsed;
}

function permissionLogMessage(level) {
  const definition = PERMISSION_LEVELS[level];
  if (level === 3) {
    return 'Elevated to LEVEL 3  FULL';
  }

  return `Set ${definition.label}`;
}

function isInsideAllowedPath(filePath, root) {
  const resolved = path.resolve(root, filePath);
  return sessionState.grants.fullAccessPaths.some((allowedPath) => (
    resolved === allowedPath || resolved.startsWith(`${allowedPath}${path.sep}`)
  ));
}

function isInsideProjectScope(filePath, root) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(root, filePath);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`);
}

function permissionDecision(allowed, approvalRequired, reason) {
  return {
    allowed,
    approvalRequired,
    reason,
  };
}
