#!/usr/bin/env node

import fs from 'node:fs';
import { emitKeypressEvents } from 'node:readline';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createHeadAdapter } from './adapters/index.js';
import { sanitizeErrorMessage } from './adapters/base.js';
import {
  addBudget,
  budgetThreshold,
  disableBudget,
  enableBudget,
  extractResponseTokens,
  formatBudgetAlert,
  formatBudgetDisplay,
  formatBudgetDoctorLine,
  formatBudgetLimitReached,
  formatExtendBudgetPrompt,
  formatUsd,
  getBudgetState,
  parseBudgetAmount,
  pauseMeteredHeads,
  recordBudgetUsage,
  resetBudget,
  resumeAllHeads,
  setBudgetAlert,
  setBudgetLimit,
  shouldPauseHead,
} from './budget.js';
import { append_entry, readHydraFile } from './hydra-file.js';
import { hydraCompleter, commandSuggestions, completionCandidates, isCompleteCommand } from './completion.js';
import { activeMemoryEntries, buildSystemContext } from './context-builder.js';
import {
  BUILTIN_COMMANDS,
  ROLE_CATEGORIES,
  ROLE_COMMANDS,
  commandExample,
  commandUsage,
  getNicknameEntries,
  getReservedCommandNames,
  isReservedCommandName,
  normalizeCommandName,
  resolveCommandName,
} from './command-registry.js';
import {
  clearPendingDecision,
  createPendingDecision,
  getDecisionHistory,
  getLastParallelDecision,
  getPendingDecision,
  loadDecisionFromTasks,
  logDecisionRevisit,
  rememberParallelResponses,
  responsesAreDifferent,
  showDecisionPrompt,
} from './decision.js';
import { loadDotEnv } from './env.js';
import {
  addHeadToRegistry,
  detectConnectedHeads,
  findHeadsByRole,
  getHead,
  getHeadCap,
  listHeads,
  normalizeAuthMode,
  removeHeadFromRegistry,
  resolveHeads,
  updateHeadInRegistry,
} from './heads.js';
import {
  buildJudgePrompt,
  describeRoleCoverage,
  findJudgeHead,
  findWorkerHeads,
  parseJudgeResponse,
  presentOrchestrationChoice,
  printJudgeRecommendation,
  recordWorkerResponses,
  shouldOrchestrate,
  startOrchestration,
} from './orchestration.js';
import {
  appendLineage,
  buildArchitectureContract,
  buildDecisionLog,
  buildGateSummary,
  buildImplementationNotes,
  buildOwnershipMap,
  buildTaskBrief,
  getTaskPaths,
  implementationNotesFileName,
  listTaskIds,
  readArtifact,
  readLineage,
  writeArchitectureContract,
  writeDecisionLog,
  writeGateSummary,
  writeImplementationNotes,
  writeOwnershipMap,
  writeTaskBrief,
} from './artifacts.js';
import {
  buildArchitectPrompt,
  buildArchitectJudgePrompt,
  buildDefaultOwnershipMap,
  findArchitectHeads,
  formatArchitectureContractForWorker,
  formatOwnershipMapForWorker,
  parseArchitectJudgeResponse,
  parseArchitectResponse,
  parseOwnershipSuggestions,
  validatePathsAgainstMap,
} from './gates.js';
import {
  buildImplementationNotesPromptSection,
  parseImplementationNotes,
} from './implementation.js';
import {
  buildIntakePrompt,
  findOracleHead,
  heuristicBriefFromPrompt,
  parseIntakeResponse,
  presentBriefForApproval,
  printTaskBriefSummary,
  suggestWorkerRoleFromBrief,
} from './intake.js';
import { getProvider, listProviders } from './providers.js';
import { bestLogoMode, bestTitleMode, centerBlock, centerLine, colorize, logoColorForConnectedHeads, logoWidth, LOGOS, systemLine, terminalWidth, TITLES } from './logo.js';
import {
  formatNativeCommandHelp,
  runNativeCommand,
} from './native-commands.js';
import {
  allowCommandOnce,
  allowPath,
  allowWritesFor,
  allowWritesThisSession,
  denyShellExecution,
  formatPermissionsStatus,
  fullPermissionsPrompt,
  getPermissionState,
  permanentFullPermissionsPrompt,
  permissionLevelFromInput,
  resetPermissions,
  setPermissionLevel,
} from './permissions.js';
import path from 'node:path';
import { HYDRA_STATE_DIR, ensureProjectState, readProjectConfig, updateProjectConfig, writeTaskLog } from './project.js';
import { invalidateHealth, setHealth } from './health.js';
import { executeTool, getToolDefinitions } from './tools.js';
import {
  MODEL_ALIASES,
  HEAD_ROLES,
  formatProviderCommandHelp,
  formatRoleContext,
  resolveHeadModel,
  resolveHeadRole,
} from './provider-commands.js';
import { formatModelShortName } from './model-display.js';
import {
  connectionDisplay,
  formatActiveHeadHeader,
  formatHeadShortLabel,
  formatHeadStatusLine,
  formatHeadStatusPrefix,
  formatPromptHeadIndicator,
  formatPromptHeadIndicatorPart,
  headDisplayColor,
  printHeadStatusBlock,
  formatHeadProviderModel,
  printPromptHeadIndicator as printPromptHeadIndicatorBlock,
  promptHeadIndicatorStatus,
  roleDisplayColor,
  subscriptionStatusDetail,
  visibleTextLength,
} from './head-display.js';
import { MENU_BACK, canUseInteractiveMenu, promptMenuChoice, promptNumberedChoice, readFilterableMenu, readMenuChoice } from './menu.js';
import { buildMenuCatalog } from './menu-catalog.js';
import {
  clearActiveInputRender,
  closeProcessQuestionInterface,
  getActiveInputRender,
  getOrCreateQuestionInterface,
  setActiveInputRender,
} from './io-state.js';
import {
  handleHeadAddCommand,
  handleHeadCommand,
  handleHeadEditCommand,
  handleHeadListCommand,
  handleHeadRemoveCommand,
  handleHeadTestCommand,
  parseHeadFlags,
} from './head-commands.js';
import {
  printConnectionStatus,
  printHeads,
  printModels,
  printProjectFileHealth,
  printProviders,
  runDoctor,
} from './doctor.js';
import { resolveKeyName, stripAnsi, truncateText } from './text-utils.js';
import { handleSetupCommand, handleGuidedHeadSetup, runSetupFinaleMenu } from './setup-wizard.js';
import { markEnd, markStart, recordSystemResponse } from './head-activity.js';
import {
  closeActiveDashboard,
  isDashboardActive,
  pauseActiveDashboard,
  resumeActiveDashboard,
  runDashboard,
} from './dashboard.js';

const args = process.argv.slice(2);
let splitTrackHeads = null;
const lastHeadResponses = new Map();
let pipedAnswers = null;

const sessionTranscript = [];
const TRANSCRIPT_MAX_EXCHANGES = 6;

function recordExchange(headId, prompt, response) {
  if (!response || !response.trim()) {
    return;
  }
  sessionTranscript.push({ headId, prompt, response, at: Date.now() });
  while (sessionTranscript.length > TRANSCRIPT_MAX_EXCHANGES) {
    sessionTranscript.shift();
  }
  saveTranscriptToDisk();
}

function formatHeadPromptContext(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    return '';
  }
  return `HEAD CUSTOM PROMPT [configured by Hydra]\n\n${text}`;
}

function formatTranscriptContext(currentHeadId) {
  if (sessionTranscript.length === 0) {
    return '';
  }
  const lines = [
    'RECENT CONVERSATION CONTEXT (oldest first):',
    'Treat the next USER message as a continuation of this same conversation.',
    'Do not restart the conversation, greet again, or ask what Hydra CLI is unless the user asks for that.',
    'Use the recent turns to resolve references like "it", "that", "the bug", "dashboard", or "Hydra".',
    '',
  ];
  for (const entry of sessionTranscript) {
    const speaker = entry.headId
      ? (entry.headId === currentHeadId ? `${entry.headId.toUpperCase()} (you, previously)` : entry.headId.toUpperCase())
      : 'ASSISTANT';
    lines.push(`USER: ${entry.prompt}`);
    lines.push(`${speaker}: ${entry.response}`);
    lines.push('');
  }
  lines.push('END OF RECENT CONVERSATION CONTEXT. Continue with the new USER message that follows.');
  return lines.join('\n').trim();
}

function clearTranscript() {
  sessionTranscript.length = 0;
}

function transcriptPath(targetPath) {
  if (targetPath) {
    return path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
  }
  return path.join(process.cwd(), HYDRA_STATE_DIR, 'transcript.json');
}

function saveTranscriptToDisk(targetPath) {
  try {
    const file = transcriptPath(targetPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sessionTranscript, null, 2), 'utf8');
    return file;
  } catch {
    return null;
  }
}

function loadTranscriptFromDisk(targetPath) {
  try {
    const file = transcriptPath(targetPath);
    if (!fs.existsSync(file)) return false;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return false;
    sessionTranscript.length = 0;
    for (const item of parsed.slice(-TRANSCRIPT_MAX_EXCHANGES)) {
      if (item && typeof item === 'object' && typeof item.headId === 'string') {
        sessionTranscript.push({
          headId: item.headId,
          prompt: String(item.prompt || ''),
          response: String(item.response || ''),
          at: Number(item.at) || Date.now(),
        });
      }
    }
    return true;
  } catch {
    return false;
  }
}

function deleteTranscriptFromDisk() {
  try {
    fs.unlinkSync(transcriptPath());
  } catch {
    // best-effort
  }
}

let currentAbortable = null;

function setCurrentAbortable(handle) {
  currentAbortable = handle;
}

function clearCurrentAbortable() {
  currentAbortable = null;
}

let sigintInstalled = false;
function installSigintHandler() {
  if (sigintInstalled) return;
  sigintInstalled = true;
  process.on('SIGINT', () => {
    if (currentAbortable) {
      try { currentAbortable(); } catch { /* ignore */ }
      currentAbortable = null;
      console.log('');
      console.log(systemLine('Cancelled. Type something else or /hydra exit to quit.', 'yellow'));
      return;
    }
    process.exit(130);
  });
}

function parseAdhocAddressing(prompt) {
  const match = String(prompt).match(/^@([A-Za-z]+)\s+(\S[\s\S]*)$/);
  if (!match) return null;
  const headId = match[1].toLowerCase();
  if (!getHead(headId)) return null;
  return { headId, prompt: match[2] };
}

async function main() {
  loadDotEnv();

  const command = args[0];

  if (String(command || '').startsWith('/')) {
    ensureProjectState();
    loadTranscriptFromDisk();
    const handled = await handleSlashLine(args.join(' '), askFromProcess);
    if (handled?.unknown) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'doctor') {
    await runDoctor();
    return;
  }

  if (command === 'heads') {
    printHeads();
    return;
  }

  if (command === 'native' || command === 'passthrough') {
    ensureProjectState();
    await handleNativeCommand(args.slice(1));
    return;
  }

  if (command === 'claude-code') {
    ensureProjectState();
    await handleNativeCommand(['claude', ...args.slice(1)]);
    return;
  }

  if (command === 'codex-cli') {
    ensureProjectState();
    await handleNativeCommand(['codex', ...args.slice(1)]);
    return;
  }

  if (command === 'ask') {
    await ask(args.slice(1));
    return;
  }

  await repl();
}

function printHelp() {
  console.log(`Hydra CLI - Cut one down, another spawns.

Usage:
  hydra                    Start interactive mode
  hydra /help              Show this guide
  hydra ask --prompt "..." Route a prompt from the shell

Core:
  /help
  /status
  /setup
  /setup head 1
  /remove head 4
  /doctor
  /exit

Routing:
  /ask "prompt"
  /chat "prompt"
  /fast "prompt"
  /all "prompt"

Common roles:
  /advisor "prompt"
  /plan "prompt"
  /code "prompt"
  /debug "prompt"
  /test "prompt"
  /review "prompt"
  /research "prompt"
  /write "prompt"
  /vision "prompt"
  /accountant "prompt"

Orchestration (assign roles to 2+ heads, then turn on):
  /hydra oracle status               Show role coverage and orchestration state
  /hydra oracle on                   Enable worker fan-out + judge merge
  /hydra oracle off                  Disable orchestration
  /hydra oracle policy <p>           auto | recommend | user_approval | user_approval_for_risk
  /hydra oracle artifacts list       Show recent orchestration tasks
  /hydra oracle artifacts show <id>  Dump task brief / decision log / gate summary / lineage
  /oracle "prompt"                   Run intake: oracle drafts Task Brief, then routes to workers + judge
  /spec "prompt"                     Talk to the spec role directly

Session:
  /resume
  /clear
  /compact
  /fork
  /side "prompt"

Info:
  /heads
  /roles
  /nicknames
  /who <command>

Talk to a specific head:
  /head1 "prompt"   /head2 "prompt"   /head3 "prompt"
  /claude "prompt"  /codex "prompt"   /gemini "prompt"
  /<nickname> "prompt"   (see /nicknames for configured aliases)

Long-form Hydra commands still work:
  /hydra commands
  /hydra head list
  /hydra auth
  /hydra workflow on
  /hydra native claude --help
`);
}

function printCommands() {
  console.log('[HYDRA] COMMANDS');
  const groups = [
    ['Core', ['/help', '/status', '/setup', '/remove head <slot>', '/doctor', '/exit', '/quit']],
    ['Guided Setup', ['/setup head 1', '/setup head 2', '/setup head 3', '/setup head new']],
    ['Info', ['/heads', '/roles', '/nicknames', '/who <command>']],
    ['Single Head', ['/head1 "prompt"', '/head2 "prompt"', '/head3 "prompt"', '/claude "prompt"', '/codex "prompt"', '/gemini "prompt"', '/<nickname> "prompt"']],
    ['Routing', ['/ask "prompt"', '/chat "prompt"', '/fast "prompt"', '/all "prompt"']],
    ['Common Roles', ['/advisor "prompt"', '/plan "prompt"', '/code "prompt"', '/debug "prompt"', '/test "prompt"', '/review "prompt"', '/research "prompt"', '/write "prompt"', '/vision "prompt"', '/accountant "prompt"']],
    ['Orchestration', ['/oracle "prompt"', '/spec "prompt"', '/hydra oracle status', '/hydra oracle on', '/hydra oracle off', '/hydra oracle policy <auto|recommend|user_approval|user_approval_for_risk>']],
    ['Session', ['/resume', '/resume <name>', '/clear', '/compact', '/fork', '/side "prompt"', '/reset', '/summarize']],
    ['System', ['/permissions', '/budget', '/memory', '/models', '/accounts', '/providers']],
    ['Long Form Hydra', ['/hydra head list', '/hydra auth', '/hydra workflow on', '/hydra native claude --help', '/hydra native codex exec --help']],
  ];

  for (const [title, commands] of groups) {
    console.log('');
    console.log(title);
    for (const command of commands) {
      console.log(`  ${command}`);
    }
  }
  console.log('');
  console.log('Use /roles for the full role list. Tab completion works for root /commands and /hydra commands.');
}

function boot() {
  const connectedHeads = detectConnectedHeads();
  const config = readProjectConfig();
  const width = terminalWidth(output);
  const logoMode = bestLogoMode(config.logo || 'full', width);

  if (logoMode !== 'off') {
    const logo = centerBlock(LOGOS[logoMode] || LOGOS.full, width);
    console.log(colorize(logo, logoColorForConnectedHeads(connectedHeads)));
  }

  console.log('');
  printBootTitle(width, logoMode);
  console.log(centerLine(taglineForWidth(width), width));
  console.log('');
  printPromptHeadIndicator(width);
  console.log('');
  printBootCommands(width);
  console.log('');
}

function titleForWidth(width) {
  return width < 24 ? TITLES.small : TITLES.medium;
}

function printBootTitle(width, logoMode) {
  if (logoMode === 'tiny') {
    return;
  }

  const titleMode = bestTitleMode(width);
  const title = titleTextForMode(titleMode, width);
  const border = '='.repeat(titleBorderWidth(title, width));

  console.log(colorize(centerLine(border, width), 'purple'));
  console.log(colorize(centerBlock(title, width), 'red'));
  console.log(colorize(centerLine(border, width), 'purple'));
}

function taglineForWidth(width) {
  return width < 26 ? 'Another spawns.' : 'Cut one down, another spawns.';
}

function titleTextForMode(mode, width) {
  if (mode === 'wide') {
    return TITLES.wide;
  }

  if (mode === 'full') {
    return TITLES.full;
  }

  return titleForWidth(width);
}

function titleBorderWidth(title, width) {
  return Math.min(width, Math.max(16, logoWidth(title)));
}

function printBootCommands(width) {
  if (width < 50) {
    console.log('/help');
    console.log('/setup');
    console.log('/doctor');
    return;
  }

  console.log('/help              View commands');
  console.log('/setup             Connect or update heads');
  console.log('/doctor            Check system health');
}

function printPromptHeadIndicator(width = terminalWidth(output)) {
  printPromptHeadIndicatorBlock(detectConnectedHeads(), width);
}

async function ensureLeadSelected(ask) {
  const config = readProjectConfig();
  const mode = config.mode || { type: 'auto', head: null };

  const heads = detectConnectedHeads();
  const callableHeads = heads.filter((head) => head.callable);

  if (callableHeads.length === 0) {
    console.log(systemLine('No callable heads yet. Run /setup head 1 or /doctor to connect one.', 'yellow'));
    return null;
  }

  const savedHead = mode.head && callableHeads.find((head) => head.id === mode.head);
  if (mode.type === 'solo' && savedHead) {
    return savedHead;
  }

  if (mode.type === 'solo' && mode.head && !savedHead) {
    console.log(systemLine(`Saved lead "${mode.head}" is no longer available. Pick again.`, 'yellow'));
  }

  const labels = callableHeads.map((head, index) => (
    `Head ${index + 1}: ${head.id} - ${head.name} (${formatHeadShortLabel(head)})`
  ));
  const index = await promptMenuChoice(ask, 'Select a lead head for plain chat', labels, 0);
  if (index === MENU_BACK || index === null) {
    console.log(systemLine('Invalid choice. Continuing without a lead — plain prompts will broadcast.', 'yellow'));
    return null;
  }

  const chosen = callableHeads[index];
  updateProjectConfig((current) => {
    current.mode = { type: 'solo', head: chosen.id };
    return current;
  });
  writeTaskLog({ type: 'mode.lead_selected', head: chosen.id });
  console.log(systemLine(`Lead set to ${chosen.name}. Plain prompts will route there. Use /hydra mode auto to broadcast.`, 'green'));
  return chosen;
}

function buildInteractivePrompt() {
  const config = readProjectConfig();
  const mode = config.mode || {};
  if (isWorkflowMode(config, mode)) {
    return `${colorize('[WORKFLOW]', 'purple')} > `;
  }
  if (mode.type === 'solo' && mode.head) {
    const head = detectConnectedHeads().find((candidate) => candidate.id === mode.head);
    if (head) {
      return `${formatHeadStatusPrefix(head)}${colorize(formatHeadShortLabel(head), headDisplayColor(head))} > `;
    }
  }
  return '> ';
}

function resolveShorthandCommand(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parts = tokenizeCommand(trimmed);
  const command = String(parts[0] || '').toLowerCase();
  if (command === '/hydra') {
    return parts;
  }

  const rest = parts.slice(1);
  if (command === '/chat') {
    return ['/hydra', 'gemini', ...rest];
  }
  if (command === '/code') {
    return ['/hydra', 'codex', 'code', ...rest];
  }
  if (command === '/advise' || command === '/advisor') {
    return ['/hydra', 'advisor', ...rest];
  }
  if (command === '/all') {
    return ['/hydra', 'all', ...rest];
  }
  if (command === '/wf') {
    return ['/hydra', 'workflow', ...(rest.length ? rest : ['status'])];
  }
  if (command === '/lead') {
    return ['/hydra', 'lead', ...rest];
  }
  if (command === '/status') {
    return ['/hydra', 'status'];
  }
  if (command === '/heads') {
    return ['/hydra', 'heads'];
  }

  return null;
}

async function runSlashCommandInDashboard(line) {
  const parts = tokenizeCommand(line);
  const commandToken = parts[0] || '';
  const commandName = normalizeCommandName(commandToken);
  const resolved = commandName ? resolveCommandName(commandName, listHeads()) : { type: 'unknown' };
  const routesToHead = ['nickname', 'head', 'role'].includes(resolved.type) && parts.length > 1;

  if (routesToHead) {
    try {
      await handleSlashLine(line, async () => '');
    } catch (err) {
      recordSystemResponse({
        prompt: line,
        text: '',
        error: err?.message || String(err),
      });
    }
    return;
  }

  const paused = await pauseActiveDashboard();
  try {
    if (paused) {
      console.log('');
      console.log(systemLine(`> ${line}`, 'purple'));
    }
    try {
      const result = await handleSlashLine(line, askFromProcess);
      if (result?.unknown) {
        console.log(systemLine(`Unknown command: ${line}`, 'yellow'));
      }
    } catch (err) {
      console.error(systemLine(`Command failed: ${err?.message || String(err)}`, 'red'));
    }
    if (paused) {
      console.log('');
      console.log(systemLine('Press any key to return to dashboard…', 'yellow'));
      await waitForAnyKey();
    }
  } finally {
    if (paused) {
      await resumeActiveDashboard();
    }
  }
}

function waitForAnyKey() {
  return new Promise((resolve) => {
    if (!input.isTTY) {
      resolve();
      return;
    }
    const wasRaw = Boolean(input.isRaw);
    try { input.setRawMode(true); } catch { /* ignore */ }
    input.resume();
    const done = () => {
      try { input.setRawMode(wasRaw); } catch { /* ignore */ }
      input.off('keypress', onKey);
      resolve();
    };
    const onKey = () => done();
    input.once('keypress', onKey);
  });
}

async function handleSlashLine(line, ask = askFromProcess) {
  try {
    return await handleSlashLineUnsafe(line, ask);
  } catch (error) {
    const message = sanitizeErrorMessage(error?.message || String(error));
    console.log(systemLine(`Command failed: ${message}`, 'red'));
    writeTaskLog({
      type: 'command.error',
      command: String(line || '').slice(0, 200),
      error: message,
    });
    return { shouldExit: false, error: true };
  }
}

async function handleSlashLineUnsafe(line, ask = askFromProcess) {
  const trimmed = String(line || '').trim();
  if (trimmed === '/') {
    return openCommandMenu(ask);
  }

  const parts = tokenizeCommand(trimmed);
  const commandToken = parts[0] || '';
  const commandName = normalizeCommandName(commandToken);

  if (!commandName) {
    return { shouldExit: false };
  }

  if (commandName === 'menu') {
    return openCommandMenu(ask);
  }

  if (commandName === 'hydra') {
    return { shouldExit: await handleHydraCommand(parts, ask) };
  }

  if (['advise', 'wf', 'lead'].includes(commandName)) {
    const legacyParts = resolveShorthandCommand(parts.join(' '));
    if (legacyParts) {
      return { shouldExit: await handleHydraCommand(legacyParts, ask) };
    }
  }

  const resolved = resolveCommandName(commandName, listHeads());
  if (resolved.type !== 'unknown') {
    return handleResolvedSlashCommand(resolved, parts.slice(1), ask);
  }

  const legacyParts = resolveShorthandCommand(parts.join(' '));
  if (legacyParts) {
    return { shouldExit: await handleHydraCommand(legacyParts, ask) };
  }

  printUnknownCommand(resolved);
  return { shouldExit: false, unknown: true };
}

async function openCommandMenu(ask) {
  if (!canUseInteractiveMenu()) {
    console.log(systemLine('Interactive menu requires a TTY. Use /help to see commands.', 'yellow'));
    return { shouldExit: false };
  }

  const catalog = buildMenuCatalog();
  const picked = await readFilterableMenu({ title: 'Hydra menu', catalog });
  if (picked === MENU_BACK || picked === null) {
    return { shouldExit: false };
  }

  const baseForm = picked.slashForm || `/${picked.name}`;
  let constructed = baseForm;

  if (picked.needsPrompt) {
    const promptText = (await ask(`Enter your prompt for ${baseForm}: `)).trim();
    if (!promptText) {
      console.log(systemLine('No prompt provided. Cancelled.', 'yellow'));
      return { shouldExit: false };
    }
    constructed = `${baseForm} ${JSON.stringify(promptText)}`;
  } else if (picked.needsArgs) {
    const argsText = (await ask(`Enter ${picked.needsArgs}: `)).trim();
    if (!argsText) {
      console.log(systemLine('No arguments provided. Cancelled.', 'yellow'));
      return { shouldExit: false };
    }
    constructed = `${baseForm} ${argsText}`;
  }
  return handleSlashLine(constructed, ask);
}

async function handleResolvedSlashCommand(resolved, argsForCommand, ask = askFromProcess) {
  if (resolved.type === 'builtin') {
    return handleBuiltinSlashCommand(resolved.definition, argsForCommand, ask);
  }

  if (resolved.type === 'role') {
    await handleRoleCommand(resolved.definition, argsForCommand, ask);
    return { shouldExit: false };
  }

  if (resolved.type === 'nickname' || resolved.type === 'head') {
    await handleResolvedHeadCommand(resolved.head, argsForCommand, ask, resolved.command);
    return { shouldExit: false };
  }

  printUnknownCommand(resolved);
  return { shouldExit: false, unknown: true };
}

async function handleBuiltinSlashCommand(definition, argsForCommand, ask = askFromProcess) {
  const command = definition.aliasFor || definition.name;

  if (command === 'help') {
    printHelp();
    return { shouldExit: false };
  }
  if (command === 'status') {
    printStatus();
    return { shouldExit: false };
  }
  if (command === 'setup') {
    await handleSetupCommand(ask, argsForCommand, { printAuthStatus, ensureSubscriptionAgreement });
    return { shouldExit: false };
  }
  if (command === 'remove') {
    await handleRemoveCommand(argsForCommand, ask);
    return { shouldExit: false };
  }
  if (command === 'doctor') {
    await runDoctor();
    return { shouldExit: false };
  }
  if (command === 'dashboard') {
    await runDashboard({
      onSubmit: async (text) => {
        const trimmed = String(text || '').trim();
        if (!trimmed) return;
        if (trimmed.startsWith('/')) {
          await runSlashCommandInDashboard(trimmed);
          return;
        }
        try {
          await routePromptForCurrentMode(text, async () => '');
        } catch (error) {
          recordSystemResponse({
            prompt: text,
            error: sanitizeErrorMessage(error),
          });
        }
      },
    });
    return { shouldExit: false };
  }
  if (command === 'exit') {
    console.log(systemLine('Session closed.', 'green'));
    return { shouldExit: true };
  }
  if (command === 'heads') {
    printHeads();
    return { shouldExit: false };
  }
  if (command === 'roles') {
    await handleRolesCommand(argsForCommand, ask);
    return { shouldExit: false };
  }
  if (command === 'nicknames') {
    printNicknames();
    return { shouldExit: false };
  }
  if (command === 'who') {
    printWho(argsForCommand[0]);
    return { shouldExit: false };
  }
  if (command === 'resume') {
    handleResumeCommand(argsForCommand);
    return { shouldExit: false };
  }
  if (command === 'clear') {
    await handleClearCommand(argsForCommand, ask);
    return { shouldExit: false };
  }
  if (command === 'compact') {
    handleCompactCommand();
    return { shouldExit: false };
  }
  if (command === 'fork') {
    handleForkCommand(argsForCommand);
    return { shouldExit: false };
  }
  if (command === 'side') {
    await handleSideCommand(argsForCommand, ask);
    return { shouldExit: false };
  }
  if (command === 'permissions') {
    await handlePermissionsCommand(argsForCommand, ask);
    return { shouldExit: false };
  }
  if (command === 'budget') {
    await handleBudgetCommand(argsForCommand, ask);
    return { shouldExit: false };
  }
  if (command === 'memory') {
    await handleMemoryCommand(argsForCommand, ask);
    return { shouldExit: false };
  }
  if (command === 'models') {
    printModels();
    return { shouldExit: false };
  }
  if (command === 'accounts') {
    printAuthStatus();
    return { shouldExit: false };
  }
  if (command === 'providers') {
    printProviders();
    return { shouldExit: false };
  }

  console.log(systemLine(`Command /${definition.name} is registered but not implemented yet.`, 'yellow'));
  return { shouldExit: false };
}

async function handleRoleCommand(definition, argsForRole, ask = askFromProcess) {
  if (definition.routeMode === 'all') {
    const prompt = parsePrompt(argsForRole);
    if (!prompt) {
      printPromptUsage(definition);
      return;
    }
    await routePrompt({ prompt, requestedHeads: ['all'], mode: 'parallel', ask });
    return;
  }

  if (definition.routeMode === 'default') {
    const prompt = parsePrompt(argsForRole);
    if (!prompt) {
      printPromptUsage(definition);
      return;
    }
    await routePromptForCurrentMode(prompt, ask);
    return;
  }

  if (!parsePrompt(argsForRole)) {
    printPromptUsage(definition);
    return;
  }

  const roleTag = definition.roleKey || definition.name;

  if (roleTag === 'oracle') {
    const prompt = parsePrompt(argsForRole);
    if (!prompt) {
      printPromptUsage(definition);
      return;
    }
    await runIntakeFlow({ prompt, ask });
    return;
  }

  if (shouldOrchestrate(roleTag)) {
    const parsed = parseUsefulHeadPromptArgs(argsForRole, null);
    await runRoleOrchestration({
      roleTag,
      prompt: parsed.prompt,
      withContextEntries: resolveWithContextEntries(parsed.withHeads),
      ask,
    });
    return;
  }

  const target = resolveHeadForRole(definition);
  if (!target?.head) {
    printNoHeadForRole(definition);
    return;
  }

  const parsed = parseUsefulHeadPromptArgs(argsForRole, target.head.id);
  if (!parsed.prompt) {
    printPromptUsage(definition);
    return;
  }

  if (definition.routeMode === 'fast' && target.reason !== 'configured') {
    console.log(systemLine(`No explicit fast/speed head is configured. Using ${target.head.name}.`, 'yellow'));
  }

  const defaultModel = definition.modelAlias
    ? resolveHeadModel(target.head.id, definition.modelAlias)
    : null;

  await routePrompt({
    prompt: parsed.prompt,
    requestedHeads: [target.head.id],
    mode: 'solo',
    ask,
    withContextEntries: resolveWithContextEntries(parsed.withHeads),
    providerCommand: {
      role: definition.roleKey || definition.name,
      model: (parsed.model || defaultModel)?.model || null,
    },
  });
}

async function handleOracleCommand(args, ask = askFromProcess) {
  const subaction = String(args[0] || 'status').toLowerCase();
  const config = readProjectConfig();
  const coverage = describeRoleCoverage(config);

  if (subaction === 'status' || subaction === 'show') {
    console.log('');
    console.log(systemLine('[ORACLE] Role coverage', 'cyan'));
    console.log(`Orchestration: ${coverage.enabled ? 'ON' : 'OFF'}    Policy: ${coverage.decision_policy}`);
    console.log(`Worker roles: ${coverage.worker_roles.join(', ') || '(none)'}`);
    console.log(`Judge role:   ${coverage.judge_role}`);
    console.log('');
    if (coverage.coverage.size === 0) {
      console.log(systemLine('No roles assigned yet. Use /setup head <N> to assign roles.', 'yellow'));
    } else {
      console.log('Assigned roles:');
      for (const [role, heads] of coverage.coverage.entries()) {
        const ids = heads.map((head) => `${head.id}${head.callable ? '' : ' (not callable)'}`).join(', ');
        const marker = coverage.worker_roles.includes(role) ? colorize('worker', 'green') : (role === coverage.judge_role ? colorize('judge', 'purple') : colorize('aux', 'yellow'));
        console.log(`  ${role.padEnd(10)} [${marker}] ${ids}`);
      }
    }
    const judge = findJudgeHead(config);
    if (!judge) {
      console.log('');
      console.log(systemLine('No callable head tagged "judge". Orchestration will fall back to the manual decision prompt.', 'yellow'));
    }
    const missingWorkers = coverage.worker_roles.filter((role) => !coverage.coverage.has(role));
    if (missingWorkers.length) {
      console.log('');
      console.log(`Missing worker roles: ${missingWorkers.join(', ')}`);
      console.log('Use /setup head <N> to assign one of these to a head.');
    }
    return;
  }

  if (subaction === 'on' || subaction === 'enable') {
    updateProjectConfig((next) => {
      next.orchestration = next.orchestration || {};
      next.orchestration.enabled = true;
      return next;
    });
    console.log(systemLine('Orchestration enabled. Worker role commands will fan out when 2+ heads share the role.', 'green'));
    return;
  }

  if (subaction === 'off' || subaction === 'disable') {
    updateProjectConfig((next) => {
      next.orchestration = next.orchestration || {};
      next.orchestration.enabled = false;
      return next;
    });
    console.log(systemLine('Orchestration disabled.', 'yellow'));
    return;
  }

  if (subaction === 'policy') {
    const policy = String(args[1] || '').toLowerCase();
    const valid = ['auto', 'recommend', 'user_approval', 'user_approval_for_risk'];
    if (!valid.includes(policy)) {
      console.log(systemLine(`Usage: /hydra oracle policy <${valid.join('|')}>`, 'yellow'));
      return;
    }
    updateProjectConfig((next) => {
      next.orchestration = next.orchestration || {};
      next.orchestration.decision_policy = policy;
      return next;
    });
    console.log(systemLine(`Decision policy set to ${policy}.`, 'green'));
    return;
  }

  if (subaction === 'artifacts') {
    await handleOracleArtifactsCommand(args.slice(1));
    return;
  }

  console.log(systemLine('Usage: /hydra oracle [status|on|off|policy <name>|artifacts list|artifacts show <task-id>]', 'yellow'));
  void ask;
}

async function handleOracleArtifactsCommand(args) {
  const sub = String(args[0] || 'list').toLowerCase();

  if (sub === 'list') {
    const taskIds = listTaskIds();
    if (taskIds.length === 0) {
      console.log(systemLine('No orchestration tasks recorded yet. Run an orchestrated worker-role command to create one.', 'yellow'));
      return;
    }
    console.log('');
    console.log(systemLine('[ORACLE] Recorded tasks', 'cyan'));
    for (const taskId of taskIds.slice(-20)) {
      const events = readLineage(taskId);
      const start = events.find((event) => event.event === 'orchestration_started');
      const close = events.find((event) => event.event === 'orchestration_closed');
      const judge = events.find((event) => event.event === 'judge_decision');
      const role = start?.role_tag || '?';
      const action = judge?.action || '?';
      const status = close?.status || '?';
      console.log(`  ${taskId}  role=${role.padEnd(10)} judge=${action.padEnd(11)} status=${status}`);
    }
    return;
  }

  if (sub === 'show') {
    const taskId = String(args[1] || '').trim();
    if (!taskId) {
      console.log(systemLine('Usage: /hydra oracle artifacts show <task-id>', 'yellow'));
      return;
    }
    const paths = getTaskPaths(taskId);
    if (!fs.existsSync(paths.taskDir)) {
      console.log(systemLine(`Task ${taskId} not found under .hydra-state/artifacts/`, 'yellow'));
      return;
    }
    console.log('');
    console.log(systemLine(`[ORACLE] task ${taskId}`, 'cyan'));
    console.log(`Directory: ${paths.taskDir}`);
    const files = fs.readdirSync(paths.taskDir).filter((name) => !name.startsWith('.'));
    console.log(`Files: ${files.join(', ') || '(empty)'}`);
    const events = readLineage(taskId);
    if (events.length) {
      console.log('');
      console.log('Lineage:');
      for (const event of events) {
        const summary = formatLineageEvent(event);
        console.log(`  ${event.timestamp || ''}  ${summary}`);
      }
    }
    const decisionLog = readArtifact(taskId, 'decision_log.json');
    if (decisionLog) {
      console.log('');
      console.log(systemLine('--- decision_log.json ---', 'purple'));
      console.log(decisionLog);
    }
    const gateFile = files.find((name) => name.startsWith('gate_') && name.endsWith('.yaml'));
    if (gateFile) {
      console.log('');
      console.log(systemLine(`--- ${gateFile} ---`, 'purple'));
      console.log(fs.readFileSync(path.join(paths.taskDir, gateFile), 'utf8'));
    }
    return;
  }

  console.log(systemLine('Usage: /hydra oracle artifacts [list|show <task-id>]', 'yellow'));
}

function formatLineageEvent(event) {
  const tag = event.event || 'event';
  const detail = Object.entries(event)
    .filter(([key]) => !['timestamp', 'event'].includes(key))
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' ');
  return `${tag}${detail ? `  ${detail}` : ''}`;
}

async function handleOrchestrationCommand(args, ask = askFromProcess) {
  // Alias for the most common toggles.
  const action = String(args[0] || '').toLowerCase();
  if (action === 'on' || action === 'enable') {
    return handleOracleCommand(['on'], ask);
  }
  if (action === 'off' || action === 'disable') {
    return handleOracleCommand(['off'], ask);
  }
  if (action === 'policy') {
    return handleOracleCommand(['policy', ...args.slice(1)], ask);
  }
  return handleOracleCommand(['status'], ask);
}

async function handleRemoveCommand(argsForRemove = [], ask = askFromProcess) {
  const target = String(argsForRemove[0] || '').toLowerCase();
  if (target !== 'head') {
    console.log(systemLine('Usage: /remove head <slot|id>', 'yellow'));
    console.log('Example: /remove head 4');
    return;
  }
  await handleHeadRemoveCommand(argsForRemove.slice(1), ask);
}

async function runArchitectureGate({ taskId, brief, prompt, ask }) {
  const architects = findArchitectHeads();
  if (architects.length === 0) {
    appendLineage(taskId, { event: 'architecture_gate_skipped', reason: 'no_architect_heads' });
    return { skipped: true };
  }

  appendLineage(taskId, { event: 'architecture_gate_started', architects: architects.map((head) => head.id) });
  console.log('');
  console.log(systemLine(`[ORACLE] Architecture gate · architects=${architects.map((head) => head.id).join(', ')}`, 'cyan'));

  const connected = detectConnectedHeads();
  const connectedById = new Map(connected.map((head) => [head.id, head]));
  const architectPrompt = buildArchitectPrompt({ brief, userPrompt: prompt });
  const queuedAsk = createQueuedAsk(ask);

  const jobs = architects.map(async (head) => {
    const status = connectedById.get(head.id);
    if (!status?.callable) {
      return { head: head.id, ok: false, error: `${head.name} not callable`, parsed: null, raw: '' };
    }
    try {
      const result = await sendPromptToHead({
        head: { ...head, ...status, model: status.model || head.defaultModel, role: 'architect' },
        status,
        prompt: architectPrompt,
        connectedHeads: connected,
        enableTools: false,
        ask: queuedAsk,
        recordHistory: false,
      });
      const raw = result?.text || '';
      const parsed = parseArchitectResponse(raw);
      return { head: head.id, ok: Boolean(result?.ok) && parsed.ok, parsed, raw };
    } catch (error) {
      return { head: head.id, ok: false, error: error?.message || String(error), parsed: null, raw: '' };
    }
  });

  const contracts = await Promise.all(jobs);
  for (const contract of contracts) {
    appendLineage(taskId, {
      event: 'architect_response',
      head: contract.head,
      ok: contract.ok,
      components: contract.parsed?.components_changed?.length || 0,
    });
  }
  const usable = contracts.filter((contract) => contract.parsed && contract.ok);
  if (usable.length === 0) {
    appendLineage(taskId, { event: 'architecture_gate_failed', reason: 'no_usable_contracts' });
    console.log(systemLine('[ORACLE] No architect produced a usable contract. Architecture gate blocked.', 'red'));
    return { blocked: true };
  }

  let chosen;
  let judgeRecord = null;
  if (usable.length === 1) {
    chosen = usable[0];
    appendLineage(taskId, { event: 'architecture_gate_single_architect', head: chosen.head });
  } else {
    const judgeHead = findJudgeHead();
    if (!judgeHead) {
      appendLineage(taskId, { event: 'architecture_judge_missing', fallback: 'first_architect' });
      console.log(systemLine('[ORACLE] No callable judge tagged. Picking the first architect contract by default.', 'yellow'));
      chosen = usable[0];
    } else {
      console.log(systemLine(`[JUDGE A] Resolving architecture conflict via ${judgeHead.name}…`, 'purple'));
      const judgeStatus = connectedById.get(judgeHead.id);
      const judgePrompt = buildArchitectJudgePrompt({ brief, userPrompt: prompt, contracts: usable });
      try {
        const result = await sendPromptToHead({
          head: { ...judgeHead, ...judgeStatus, model: judgeStatus.model || judgeHead.defaultModel, role: 'judge' },
          status: judgeStatus,
          prompt: judgePrompt,
          connectedHeads: connected,
          enableTools: false,
          ask: queuedAsk,
          recordHistory: false,
        });
        judgeRecord = parseArchitectJudgeResponse(result?.text || '');
        appendLineage(taskId, {
          event: 'architecture_judge_decision',
          action: judgeRecord.action,
          confidence: judgeRecord.confidence,
          selected_option: judgeRecord.selected_option,
          parse_ok: judgeRecord.ok,
        });
        if (judgeRecord.action === 'pick' && judgeRecord.selected_option) {
          const idx = judgeRecord.selected_option.charCodeAt(0) - 65;
          chosen = usable[idx] || usable[0];
        } else if (judgeRecord.action === 'merge_components') {
          chosen = mergeArchitectContracts(usable, judgeRecord.merged_components);
        } else {
          console.log('');
          console.log(systemLine(`[JUDGE A] Defers to user. Reason: ${judgeRecord.reasoning}`, 'yellow'));
          const labels = usable.map((contract, index) => `${String.fromCharCode(65 + index)} (${contract.head})`);
          const pick = (await ask(`Pick architecture contract [${labels.join(' / ')}] or [X]cancel: `)).trim().toUpperCase();
          if (pick === 'X') {
            appendLineage(taskId, { event: 'architecture_gate_user_cancelled' });
            return { blocked: true };
          }
          const idx = pick.charCodeAt(0) - 65;
          chosen = usable[idx] || usable[0];
          appendLineage(taskId, { event: 'architecture_user_pick', head: chosen.head });
        }
      } catch (error) {
        appendLineage(taskId, { event: 'architecture_judge_error', error: error?.message || String(error) });
        console.log(systemLine(`Architect judge call failed: ${error?.message || error}. Picking first architect.`, 'yellow'));
        chosen = usable[0];
      }
    }
  }

  const artifact = buildArchitectureContract({
    taskId,
    ownerHead: chosen.head,
    componentsChanged: chosen.parsed.components_changed,
    boundaries: chosen.parsed.boundaries,
    interfaces: chosen.parsed.interfaces,
    invariants: chosen.parsed.invariants,
    ownershipSuggestions: chosen.parsed.ownership_suggestions,
    failureModes: chosen.parsed.failure_modes,
    testStrategy: chosen.parsed.test_strategy,
    securityOpsConsiderations: chosen.parsed.security_ops_considerations,
    tradeoffs: chosen.parsed.tradeoffs,
    deferredDecisions: chosen.parsed.deferred_decisions,
    notes: chosen.parsed.notes,
  });
  const writeResult = writeArchitectureContract(taskId, artifact);
  appendLineage(taskId, {
    event: 'artifact_created',
    artifact: 'architecture_contract',
    version: 1,
    owner_head: chosen.head,
    path: writeResult.path,
    json_path: writeResult.jsonPath,
    validation_ok: writeResult.validation.ok,
    validation_errors: writeResult.validation.errors,
  });

  const gateArtifact = buildGateSummary({
    taskId,
    gate: 'architecture_gate',
    status: writeResult.validation.ok ? 'pass' : 'blocked',
    updatedArtifacts: ['architecture_contract@v1'],
    blockers: writeResult.validation.ok ? [] : writeResult.validation.errors.map((error, index) => ({ id: `B-${String(index + 1).padStart(3, '0')}`, owner_role: 'architect', description: error })),
    conflicts: usable.length > 1 ? [{ id: 'C-001', roles: ['architect', 'architect'], summary: 'Two architects produced separate contracts.' }] : [],
    judgeCheckpointRequired: false,
    backtracksUsedInPhase: 0,
    nextGate: writeResult.validation.ok ? 'ownership_gate' : null,
    notes: `architects=${usable.map((c) => c.head).join(',')}; selected=${chosen.head}${judgeRecord ? `; judge=${judgeRecord.action}/${judgeRecord.confidence}` : ''}`,
  });
  const gateWrite = writeGateSummary(taskId, gateArtifact);
  appendLineage(taskId, {
    event: 'artifact_created',
    artifact: 'gate_summary',
    version: 1,
    path: gateWrite.path,
    validation_ok: gateWrite.validation.ok,
  });

  console.log('');
  console.log(systemLine(`[ORACLE] Architecture gate ${writeResult.validation.ok ? 'PASS' : 'BLOCKED'} · owner=${chosen.head}`, writeResult.validation.ok ? 'green' : 'red'));
  if (!writeResult.validation.ok) {
    for (const error of writeResult.validation.errors) {
      console.log(`  - ${error}`);
    }
    return { blocked: true };
  }
  return { contract: chosen.parsed, ownerHead: chosen.head };
}

async function runOwnershipGate({ taskId, architectureContract, defaultRole }) {
  if (!architectureContract) {
    appendLineage(taskId, { event: 'ownership_gate_skipped', reason: 'no_architecture_contract' });
    return { skipped: true };
  }
  appendLineage(taskId, { event: 'ownership_gate_started' });

  const parsed = parseOwnershipSuggestions(architectureContract.ownership_suggestions || [], { defaultRole });
  const usingSuggestions = parsed.tracks.length > 0;
  const seed = usingSuggestions
    ? parsed
    : buildDefaultOwnershipMap({ defaultRole, components: architectureContract.components_changed || [] });

  const artifact = buildOwnershipMap({
    taskId,
    tracks: seed.tracks,
    sharedFiles: seed.shared_files,
    crossCuttingChanges: seed.cross_cutting_changes,
    notes: usingSuggestions
      ? 'Derived from architecture_contract.ownership_suggestions[]'
      : 'No architect-supplied ownership suggestions; default catch-all track generated from components_changed.',
  });
  const writeResult = writeOwnershipMap(taskId, artifact);
  appendLineage(taskId, {
    event: 'artifact_created',
    artifact: 'ownership_map',
    version: 1,
    path: writeResult.path,
    validation_ok: writeResult.validation.ok,
    validation_errors: writeResult.validation.errors,
    derived: usingSuggestions ? 'from_suggestions' : 'default_catch_all',
  });

  const gateArtifact = buildGateSummary({
    taskId,
    gate: 'ownership_gate',
    status: writeResult.validation.ok ? 'pass' : 'blocked',
    updatedArtifacts: ['ownership_map@v1'],
    blockers: writeResult.validation.ok ? [] : writeResult.validation.errors.map((error, index) => ({ id: `B-${String(index + 1).padStart(3, '0')}`, owner_role: 'oracle', description: error })),
    conflicts: [],
    judgeCheckpointRequired: false,
    backtracksUsedInPhase: 0,
    nextGate: writeResult.validation.ok ? 'parallel_build' : null,
    notes: `tracks=${seed.tracks.length}; shared=${seed.shared_files.length}; cross_cutting=${seed.cross_cutting_changes.length}; default_role=${defaultRole}`,
  });
  const gateWrite = writeGateSummary(taskId, gateArtifact);
  appendLineage(taskId, {
    event: 'artifact_created',
    artifact: 'gate_summary',
    version: 1,
    path: gateWrite.path,
    validation_ok: gateWrite.validation.ok,
  });

  console.log('');
  console.log(systemLine(`[ORACLE] Ownership gate ${writeResult.validation.ok ? 'PASS' : 'BLOCKED'} · tracks=${seed.tracks.length}${seed.shared_files.length ? ` · shared=${seed.shared_files.length}` : ''}`, writeResult.validation.ok ? 'green' : 'red'));
  if (!writeResult.validation.ok) {
    for (const error of writeResult.validation.errors) console.log(`  - ${error}`);
    return { blocked: true };
  }
  return { map: artifact };
}

function mergeArchitectContracts(usable, requestedComponents) {
  const base = usable[0].parsed;
  const components = new Set(base.components_changed);
  for (const contract of usable.slice(1)) {
    for (const comp of contract.parsed.components_changed) components.add(comp);
  }
  for (const requested of requestedComponents || []) components.add(requested);
  return {
    head: usable.map((c) => c.head).join('+'),
    ok: true,
    parsed: {
      ...base,
      components_changed: Array.from(components),
      notes: `Merged components from ${usable.map((c) => c.head).join(', ')}.`,
    },
    raw: '',
  };
}

async function runIntakeFlow({ prompt, ask }) {
  const taskId = startOrchestration({ prompt, roleTag: 'oracle' });
  appendLineage(taskId, { event: 'intake_started' });

  const oracleHead = findOracleHead();
  let brief;
  let editNote = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!oracleHead) {
      brief = heuristicBriefFromPrompt(prompt);
      appendLineage(taskId, { event: 'intake_brief_heuristic' });
      break;
    }

    const intakePrompt = editNote
      ? `${buildIntakePrompt(prompt)}\n\nUSER EDIT NOTE (revise the brief accordingly):\n${editNote}`
      : buildIntakePrompt(prompt);
    const connected = detectConnectedHeads();
    const status = connected.find((head) => head.id === oracleHead.id);
    if (!status?.callable) {
      brief = heuristicBriefFromPrompt(prompt);
      appendLineage(taskId, { event: 'intake_brief_heuristic', reason: 'oracle_not_callable' });
      break;
    }

    console.log('');
    console.log(systemLine(`[ORACLE] Drafting Task Brief via ${oracleHead.name}…`, 'cyan'));
    let raw = '';
    try {
      const result = await sendPromptToHead({
        head: { ...oracleHead, ...status, model: status.model || oracleHead.defaultModel, role: 'oracle' },
        status,
        prompt: intakePrompt,
        connectedHeads: connected,
        enableTools: false,
        ask,
        recordHistory: false,
      });
      raw = result?.text || '';
    } catch (error) {
      appendLineage(taskId, { event: 'intake_oracle_error', error: error?.message || String(error) });
      console.log(systemLine(`Oracle intake failed: ${error?.message || error}. Falling back to heuristic brief.`, 'yellow'));
      brief = heuristicBriefFromPrompt(prompt);
      break;
    }

    brief = parseIntakeResponse(raw);
    appendLineage(taskId, {
      event: 'intake_brief_drafted',
      parse_ok: brief.ok,
      risk_level: brief.risk_level,
      approval_policy: brief.approval_policy,
      suggested_worker_role: brief.suggested_worker_role,
    });

    printTaskBriefSummary({ brief, oracleHead, taskId });
    const result = await presentBriefForApproval({ brief, ask });
    appendLineage(taskId, { event: 'intake_user_choice', action: result.action });

    if (result.action === 'accept') {
      brief = result.brief;
      break;
    }
    if (result.action === 'cancel') {
      appendLineage(taskId, { event: 'intake_cancelled' });
      console.log(systemLine('[ORACLE] Intake cancelled. No workers run.', 'yellow'));
      return;
    }
    if (result.action === 'edit') {
      editNote = result.note || '';
      if (!editNote) {
        console.log(systemLine('No edit note provided. Keeping the brief as-is.', 'yellow'));
        brief = result.brief;
        break;
      }
      console.log(systemLine('Re-prompting oracle with your note…', 'cyan'));
    }
  }

  if (!brief) {
    brief = heuristicBriefFromPrompt(prompt);
  }

  const taskBriefArtifact = buildTaskBrief({
    taskId,
    goal: brief.goal || prompt,
    nonGoals: brief.non_goals,
    acceptanceCriteria: brief.acceptance_criteria.length ? brief.acceptance_criteria : ['User accepts the change after review'],
    riskLevel: brief.risk_level,
    approvalPolicy: brief.approval_policy,
    constraints: brief.constraints,
    assumptions: brief.assumptions,
    repoArea: brief.repo_area,
  });
  taskBriefArtifact.status = 'ready';
  const briefWrite = writeTaskBrief(taskId, taskBriefArtifact);
  appendLineage(taskId, {
    event: 'artifact_created',
    artifact: 'task_brief',
    version: 1,
    path: briefWrite.path,
    validation_ok: briefWrite.validation.ok,
    validation_errors: briefWrite.validation.errors,
  });

  const config = readProjectConfig();
  const workerRole = brief.suggested_worker_role && Array.isArray(config?.orchestration?.worker_roles) && config.orchestration.worker_roles.includes(brief.suggested_worker_role)
    ? brief.suggested_worker_role
    : suggestWorkerRoleFromBrief(brief, config);

  appendLineage(taskId, { event: 'intake_worker_role_chosen', worker_role: workerRole });

  const workersAvailable = findWorkerHeads(workerRole);
  if (workersAvailable.length < 2) {
    console.log('');
    console.log(systemLine(`[ORACLE] Task Brief saved. ${workersAvailable.length} head(s) tagged "${workerRole}" — not enough to fan out (need 2+). Brief is ready under .hydra-state/artifacts/${taskId}/.`, 'yellow'));
    appendLineage(taskId, { event: 'intake_blocked_no_workers', worker_role: workerRole, callable_workers: workersAvailable.length });
    return;
  }

  if (brief.approval_policy === 'user_approval' || (brief.approval_policy === 'user_approval_for_risk' && (brief.risk_level === 'high' || brief.risk_level === 'critical'))) {
    const goAhead = (await ask(`Approval policy "${brief.approval_policy}" at risk "${brief.risk_level}". Run ${workersAvailable.length} ${workerRole} heads + judge? [y/N]: `)).trim().toLowerCase();
    if (goAhead !== 'y' && goAhead !== 'yes') {
      appendLineage(taskId, { event: 'intake_user_declined_run' });
      console.log(systemLine('[ORACLE] User declined to run workers. Task Brief is saved.', 'yellow'));
      return;
    }
  }

  let architectureContract = null;
  if (findArchitectHeads().length > 0) {
    const gateResult = await runArchitectureGate({ taskId, brief, prompt, ask });
    if (gateResult.blocked) {
      console.log(systemLine('[ORACLE] Architecture gate blocked. Workers will not run.', 'yellow'));
      return;
    }
    if (gateResult.contract) {
      architectureContract = gateResult.contract;
    }
  } else {
    appendLineage(taskId, { event: 'architecture_gate_skipped', reason: 'no_architect_heads' });
  }

  let ownershipMap = null;
  if (architectureContract) {
    const ownershipResult = await runOwnershipGate({ taskId, architectureContract, defaultRole: workerRole });
    if (ownershipResult.blocked) {
      console.log(systemLine('[ORACLE] Ownership gate blocked. Workers will not run.', 'yellow'));
      return;
    }
    ownershipMap = ownershipResult.map || null;
  }

  await runRoleOrchestration({
    roleTag: workerRole,
    prompt,
    ask,
    taskId,
    brief,
    riskLevel: brief.risk_level,
    architectureContract,
    ownershipMap,
  });
}

async function runRoleOrchestration({ roleTag, prompt, withContextEntries = [], ask, taskId: existingTaskId = null, brief = null, riskLevel = null, architectureContract = null, ownershipMap = null }) {
  const workers = findWorkerHeads(roleTag);
  if (workers.length < 2) {
    console.log(systemLine(`Orchestration needs 2+ heads tagged "${roleTag}". Found ${workers.length}. Falling back.`, 'yellow'));
    return;
  }

  const taskId = existingTaskId || startOrchestration({ prompt, roleTag });
  if (existingTaskId) {
    appendLineage(taskId, { event: 'orchestration_continued', role_tag: roleTag });
  }
  const connected = detectConnectedHeads();
  const connectedById = new Map(connected.map((head) => [head.id, head]));

  console.log('');
  console.log(systemLine(`[ORCHESTRATION] task ${taskId} · role=${roleTag} · workers=${workers.map((h) => h.id).join(', ')}`, 'cyan'));

  const queuedAsk = createQueuedAsk(ask);
  const prefixSections = [];
  if (architectureContract) prefixSections.push(formatArchitectureContractForWorker(architectureContract));
  if (ownershipMap) prefixSections.push(formatOwnershipMapForWorker(ownershipMap, { headRole: roleTag }));
  if (ownershipMap) prefixSections.push(buildImplementationNotesPromptSection({ ownershipMap, roleTag }));
  const contractPrefix = prefixSections.length
    ? `${prefixSections.join('\n\n')}\n\nUSER PROMPT:\n${prompt}`
    : prompt;
  const jobs = workers.map(async (head) => {
    const status = connectedById.get(head.id);
    if (!status?.callable) {
      return { head: head.id, ok: false, text: '', error: `${head.name} is not callable.` };
    }
    const effectiveHead = { ...head, ...status, model: status.model || head.defaultModel, role: roleTag };
    try {
      const result = await sendPromptToHead({
        head: effectiveHead,
        status,
        prompt: contractPrefix,
        connectedHeads: connected,
        withContextEntries,
        enableTools: true,
        ask: queuedAsk,
        recordHistory: false,
      });
      return { head: head.id, ok: Boolean(result?.ok), text: result?.text || '', error: result?.error || null };
    } catch (error) {
      return { head: head.id, ok: false, text: '', error: error?.message || String(error) };
    }
  });

  const workerResponses = await Promise.all(jobs);
  const successful = workerResponses.filter((response) => response.ok && response.text.trim());
  recordWorkerResponses(taskId, workerResponses);

  if (successful.length === 0) {
    appendLineage(taskId, { event: 'orchestration_failed', reason: 'no_successful_workers' });
    console.log(systemLine('[ORCHESTRATION] all workers failed. Try a different prompt.', 'red'));
    return;
  }

  const implementationRecords = ownershipMap
    ? writeWorkerImplementationNotes({ taskId, roleTag, responses: successful, ownershipMap })
    : [];

  if (successful.length === 1) {
    appendLineage(taskId, { event: 'orchestration_solo', head: successful[0].head });
    console.log('');
    console.log(systemLine(`Only one worker responded successfully (${successful[0].head}). Using that answer.`, 'yellow'));
    console.log('');
    console.log(successful[0].text);
    return;
  }

  const judgeHead = findJudgeHead();
  if (!judgeHead) {
    appendLineage(taskId, { event: 'judge_missing', fallback: 'user_decision' });
    console.log(systemLine('No head tagged "judge" is callable. Falling back to manual decision UI.', 'yellow'));
    const decision = createPendingDecision(prompt, successful);
    const decisionResult = await showDecisionPrompt(successful.map((response) => ({ head: response.head, content: response.text })), prompt, ask, {
      adapters: createDecisionAdapters(successful, connectedById),
      decision,
    });
    applyDecisionResult(decisionResult);
    return;
  }

  const judgeStatus = connectedById.get(judgeHead.id);
  const judgePrompt = buildJudgePrompt({ originalPrompt: prompt, responses: successful, roleTag });
  console.log('');
  console.log(systemLine(`[JUDGE] routing to ${judgeHead.name}…`, 'purple'));
  let judgeRaw;
  try {
    const result = await sendPromptToHead({
      head: { ...judgeHead, ...judgeStatus, model: judgeStatus.model || judgeHead.defaultModel, role: 'judge' },
      status: judgeStatus,
      prompt: judgePrompt,
      connectedHeads: connected,
      enableTools: false,
      ask: queuedAsk,
      recordHistory: false,
    });
    judgeRaw = result?.text || '';
    appendLineage(taskId, { event: 'judge_response', head: judgeHead.id, ok: Boolean(result?.ok), length: judgeRaw.length });
  } catch (error) {
    appendLineage(taskId, { event: 'judge_error', head: judgeHead.id, error: error?.message || String(error) });
    console.log(systemLine(`Judge call failed: ${error?.message || error}. Falling back to manual decision.`, 'red'));
    const decision = createPendingDecision(prompt, successful);
    const decisionResult = await showDecisionPrompt(successful.map((response) => ({ head: response.head, content: response.text })), prompt, ask, {
      adapters: createDecisionAdapters(successful, connectedById),
      decision,
    });
    applyDecisionResult(decisionResult);
    return;
  }

  const judge = parseJudgeResponse(judgeRaw);
  appendLineage(taskId, {
    event: 'judge_decision',
    action: judge.action,
    confidence: judge.confidence,
    selected_option: judge.selected_option,
    parse_ok: judge.ok,
  });

  printJudgeRecommendation({ judge, responses: successful, judgeHead, taskId });

  const config = readProjectConfig();
  const choice = await presentOrchestrationChoice({
    judge,
    responses: successful,
    ask,
    decisionPolicy: config?.orchestration?.decision_policy || 'recommend',
  });
  appendLineage(taskId, { event: 'user_choice', action: choice.action });

  if (choice.action === 'manual') {
    const decision = createPendingDecision(prompt, successful);
    const decisionResult = await showDecisionPrompt(successful.map((response) => ({ head: response.head, content: response.text })), prompt, ask, {
      adapters: createDecisionAdapters(successful, connectedById),
      decision,
    });
    applyDecisionResult(decisionResult);
  }

  const decisionArtifact = buildDecisionLog({
    taskId,
    checkpoint: 'C',
    riskLevel: riskLevel || brief?.risk_level || 'medium',
    roleTag,
    prompt,
    responses: successful,
    judge,
    userChoice: choice,
  });
  const decisionInputs = [];
  if (brief) decisionInputs.push({ artifact: 'task_brief', version: 1 });
  if (architectureContract) decisionInputs.push({ artifact: 'architecture_contract', version: 1 });
  if (ownershipMap) decisionInputs.push({ artifact: 'ownership_map', version: 1 });
  for (const record of implementationRecords) {
    decisionInputs.push({ artifact: 'implementation_notes', version: 1, owner_head: record.head });
  }
  if (decisionInputs.length) {
    decisionArtifact.inputs = decisionInputs;
  }
  const decisionWrite = writeDecisionLog(taskId, decisionArtifact);
  appendLineage(taskId, {
    event: 'artifact_created',
    artifact: 'decision_log',
    version: 1,
    path: decisionWrite.path,
    validation_ok: decisionWrite.validation.ok,
    validation_errors: decisionWrite.validation.errors,
  });

  const gateStatus = (() => {
    if (choice.action === 'cancel') return 'fail';
    if (choice.action === 'manual' || choice.action === 'pick') return 'pass';
    if (judge.action === 'ask_user' && choice.action !== 'accept') return 'blocked';
    return 'pass';
  })();
  const gateArtifact = buildGateSummary({
    taskId,
    gate: 'judge_verify_checkpoint_c',
    status: gateStatus,
    updatedArtifacts: ['decision_log@v1'],
    blockers: gateStatus === 'blocked' ? [{ id: 'B-001', owner_role: 'judge', description: judge.user_question || 'judge deferred to user' }] : [],
    conflicts: [],
    judgeCheckpointRequired: false,
    backtracksUsedInPhase: 0,
    nextGate: gateStatus === 'pass' ? 'user_result' : null,
    notes: `role_tag=${roleTag}; workers=${workers.map((h) => h.id).join(',')}; judge=${judgeHead.id}; action=${judge.action}; confidence=${judge.confidence}`,
  });
  const gateWrite = writeGateSummary(taskId, gateArtifact);
  appendLineage(taskId, {
    event: 'artifact_created',
    artifact: 'gate_summary',
    version: 1,
    path: gateWrite.path,
    validation_ok: gateWrite.validation.ok,
    validation_errors: gateWrite.validation.errors,
  });
  appendLineage(taskId, { event: 'orchestration_closed', task_id: taskId, status: gateStatus });

  console.log('');
  console.log(systemLine(`[ORCHESTRATION] task ${taskId} → ${gateStatus} · decision log + gate summary saved under .hydra-state/artifacts/${taskId}/`, gateStatus === 'pass' ? 'green' : 'yellow'));
}

function writeWorkerImplementationNotes({ taskId, roleTag, responses, ownershipMap }) {
  const records = [];
  const blockers = [];

  for (const response of responses) {
    const parsed = parseImplementationNotes(response.text);
    const filePaths = parsed.files_changed.map((file) => file.path).filter(Boolean);
    const ownershipValidation = validatePathsAgainstMap(filePaths, ownershipMap, { writes: true });
    const ref = `${implementationNotesFileName(response.head).replace(/\.md$/, '')}@v1`;

    response.implementation_notes = parsed;
    response.ownership_violations = ownershipValidation.violations;
    response.implementation_notes_ref = ref;

    if (!parsed.ok) {
      blockers.push({ id: `B-${String(blockers.length + 1).padStart(3, '0')}`, owner_role: roleTag, owner_head: response.head, description: 'Worker did not emit parseable Implementation Notes JSON.' });
      console.log(systemLine(`[ORACLE] ${response.head} did not emit parseable Implementation Notes.`, 'yellow'));
    }
    for (const violation of ownershipValidation.violations) {
      blockers.push({
        id: `B-${String(blockers.length + 1).padStart(3, '0')}`,
        owner_role: roleTag,
        owner_head: response.head,
        description: `${violation.kind}: ${violation.path}`,
      });
    }
    if (ownershipValidation.violations.length) {
      console.log(systemLine(`[ORACLE] ${response.head} proposed ${ownershipValidation.violations.length} path(s) outside the Ownership Map.`, 'yellow'));
    }

    const artifact = buildImplementationNotes({
      taskId,
      ownerHead: response.head,
      ownerRole: roleTag,
      trackId: parsed.track_id,
      filesChanged: parsed.files_changed,
      summary: parsed.summary,
      assumptions: parsed.assumptions,
      rollbackNotes: parsed.rollback_notes,
      verificationSuggested: parsed.verification_suggested,
      status: parsed.ok && ownershipValidation.ok ? 'ready' : 'blocked',
      parseOk: parsed.ok,
      ownershipValidation,
    });
    const writeResult = writeImplementationNotes(taskId, artifact, process.cwd(), { ownershipMap });
    response.implementation_notes_validation = writeResult.validation;

    if (!writeResult.validation.ok) {
      for (const error of writeResult.validation.errors) {
        blockers.push({
          id: `B-${String(blockers.length + 1).padStart(3, '0')}`,
          owner_role: roleTag,
          owner_head: response.head,
          description: error,
        });
      }
    }

    appendLineage(taskId, {
      event: 'implementation_notes_parsed',
      head: response.head,
      parse_ok: parsed.ok,
      track_id: parsed.track_id,
      files_changed: parsed.files_changed.length,
      ownership_ok: ownershipValidation.ok,
      ownership_violations: ownershipValidation.violations,
    });
    appendLineage(taskId, {
      event: 'artifact_created',
      artifact: 'implementation_notes',
      version: 1,
      owner_head: response.head,
      path: writeResult.path,
      validation_ok: writeResult.validation.ok,
      validation_errors: writeResult.validation.errors,
    });

    records.push({
      head: response.head,
      ref,
      path: writeResult.path,
      validation: writeResult.validation,
      ownershipValidation,
    });
  }

  const gateStatus = blockers.length ? 'blocked' : 'pass';
  const gateArtifact = buildGateSummary({
    taskId,
    gate: 'parallel_build',
    status: gateStatus,
    updatedArtifacts: records.map((record) => record.ref),
    blockers,
    conflicts: [],
    judgeCheckpointRequired: blockers.length > 0,
    backtracksUsedInPhase: 0,
    nextGate: 'judge_verify_checkpoint_c',
    notes: `implementation_notes=${records.length}; ownership_violations=${blockers.length}; continuing_to_judge=true`,
  });
  const gateWrite = writeGateSummary(taskId, gateArtifact);
  appendLineage(taskId, {
    event: 'artifact_created',
    artifact: 'gate_summary',
    version: 1,
    path: gateWrite.path,
    validation_ok: gateWrite.validation.ok,
    validation_errors: gateWrite.validation.errors,
  });

  return records;
}

async function handleResolvedHeadCommand(head, argsForHead, ask = askFromProcess, commandName = head.id) {
  const parsed = parseHeadPromptArgs(argsForHead, head.id);
  if (!parsed.prompt) {
    if (parsed.role || parsed.model) {
      saveHeadProviderDefaults(head.id, parsed);
      return;
    }
    console.log(systemLine(`Usage: /${commandName} "prompt"`, 'yellow'));
    console.log(`Example: /${commandName} "Help me with this"`);
    return;
  }

  await routePrompt({
    prompt: parsed.prompt,
    requestedHeads: [head.id],
    mode: 'solo',
    ask,
    withContextEntries: resolveWithContextEntries(parsed.withHeads),
    providerCommand: {
      role: parsed.role?.key || null,
      model: parsed.model?.model || null,
    },
  });
}

function resolveHeadForRole(definition) {
  const heads = listHeads();
  const configured = findHeadByRoleNames(roleNamesForDefinition(definition), heads);
  if (configured) {
    return { head: configured, reason: 'configured' };
  }

  if (definition.routeMode === 'fast') {
    const defaultHead = heads.find((head) => head.id === definition.defaultHead);
    const callable = firstCallableHead(heads, ['codex', 'gemini', 'claude']);
    const fast = findHeadByRoleNames(['fast', 'speed', 'quick'], heads)
      || findCustomHeadByDefaultRole(['fast', 'speed', 'quick'], heads)
      || (defaultHead && isHeadCallable(defaultHead.id) ? defaultHead : null)
      || callable
      || defaultHead
      || heads[0]
      || null;
    return fast ? { head: fast, reason: fast.id === definition.defaultHead ? 'default' : 'available' } : null;
  }

  if (definition.requiresMediaHead) {
    return null;
  }

  const customDefault = findCustomHeadByDefaultRole(roleNamesForDefinition(definition), heads);
  if (customDefault) {
    return { head: customDefault, reason: 'default-role' };
  }

  const defaultHead = definition.defaultHead
    ? heads.find((head) => head.id === definition.defaultHead)
    : null;
  return defaultHead ? { head: defaultHead, reason: 'default' } : null;
}

function findHeadByRoleNames(roleNames, heads = listHeads()) {
  const config = readProjectConfig();
  const accepted = new Set(roleNames.map(normalizeCommandName));

  for (const head of heads) {
    const configuredRole = config.roles?.[head.id];
    if (configuredRole && roleTextMatches(configuredRole, accepted)) {
      return head;
    }
  }

  return null;
}

function findCustomHeadByDefaultRole(roleNames, heads = listHeads()) {
  const accepted = new Set(roleNames.map(normalizeCommandName));
  for (const head of heads) {
    if (!head.builtin && head.defaultRole && roleTextMatches(head.defaultRole, accepted)) {
      return head;
    }
  }

  return null;
}

function roleTextMatches(value, accepted) {
  const normalized = normalizeCommandName(value);
  if (accepted.has(normalized)) {
    return true;
  }

  const tokens = String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => accepted.has(normalizeCommandName(token)));
}

function roleNamesForDefinition(definition) {
  const aliases = {
    code: ['code', 'builder', 'coder', 'coding'],
    review: ['review', 'reviewer'],
    test: ['test', 'tester', 'qa'],
    secure: ['secure', 'security'],
    research: ['research', 'researcher'],
    write: ['write', 'writer'],
    advisor: ['advisor', 'advise'],
  };
  return Array.from(new Set([
    definition.name,
    definition.roleKey,
    ...(aliases[definition.name] || []),
  ].filter(Boolean)));
}

function firstCallableHead(heads, preferredOrder) {
  const connected = detectConnectedHeads();
  const callableIds = new Set(connected.filter((head) => head.callable).map((head) => head.id));
  for (const id of preferredOrder) {
    const match = heads.find((head) => head.id === id && callableIds.has(head.id));
    if (match) return match;
  }
  return heads.find((head) => callableIds.has(head.id)) || null;
}

function isHeadCallable(headId) {
  return detectConnectedHeads().some((head) => head.id === headId && head.callable);
}

function findDirectHead(commandName) {
  const name = normalizeCommandName(commandName);
  return listHeads().find((head) => (
    normalizeCommandName(head.id) === name
    || normalizeCommandName(head.name) === name
  )) || null;
}

function printPromptUsage(definition) {
  console.log(systemLine(`Usage: ${commandUsage(definition)}`, 'yellow'));
  console.log(`Example: ${commandExample(definition)}`);
}

function printNoHeadForRole(definition) {
  if (definition.requiresMediaHead) {
    console.log(systemLine(`No media-capable head is configured for /${definition.name}.`, 'yellow'));
    console.log('Hydra does not have image/media input routing enabled for this role yet.');
  } else {
    console.log(systemLine(`No head is configured for /${definition.name}.`, 'yellow'));
  }
  console.log('Run /heads to see available heads or /roles to see role commands.');
}

function printUnknownCommand(resolved) {
  console.log(systemLine(`Unknown command: /${resolved.command}`, 'yellow'));
  if (resolved.suggestions?.length) {
    console.log(`Did you mean /${resolved.suggestions[0]}?`);
  } else {
    console.log('Run /help for the command list.');
  }
}

async function repl() {
  ensureProjectState();
  installSigintHandler();
  loadTranscriptFromDisk();
  boot();

  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    await replWithReadlineFallback();
    return;
  }

  const redrawOnResize = () => {
    if (!output.isTTY) {
      return;
    }

    output.write('\x1b[2J\x1b[H');
    boot();
    renderActiveInput();
  };

  output.on('resize', redrawOnResize);

  try {
    let showPromptIndicator = false;
    while (true) {
      if (showPromptIndicator) {
        printPromptHeadIndicator();
      }

      const line = await readInteractiveLine({ prompt: buildInteractivePrompt(), suggestions: true });
      const trimmed = line.trim();

      if (!trimmed) {
        showPromptIndicator = false;
        continue;
      }

      showPromptIndicator = true;

      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log(systemLine('Session closed.', 'green'));
        return;
      }

      if (trimmed.startsWith('/')) {
        const result = await handleSlashLine(trimmed, (question) => readInteractiveLine({ prompt: question }));
        if (result?.shouldExit) {
          return;
        }
        continue;
      }

      const routed = await routePromptForCurrentMode(trimmed, (question) => readInteractiveLine({ prompt: question }));
      if (routed?.endSession) {
        console.log(systemLine('Session ended.', 'green'));
        return;
      }
    }
  } finally {
    output.off('resize', redrawOnResize);
    clearActiveInputRender();
  }
}

async function replWithReadlineFallback() {
  const rl = readline.createInterface({ input, output, completer: hydraCompleter });
  try {
    let showPromptIndicator = false;
    while (true) {
      if (showPromptIndicator) {
        printPromptHeadIndicator();
      }

      const line = await rl.question(buildInteractivePrompt());
      const trimmed = line.trim();

      if (!trimmed) {
        showPromptIndicator = false;
        continue;
      }

      showPromptIndicator = true;

      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log(systemLine('Session closed.', 'green'));
        return;
      }

      if (trimmed.startsWith('/')) {
        const result = await handleSlashLine(trimmed, (question) => rl.question(question));
        if (result?.shouldExit) {
          return;
        }
        continue;
      }

      const routed = await routePromptForCurrentMode(trimmed, (question) => rl.question(question));
      if (routed?.endSession) {
        console.log(systemLine('Session ended.', 'green'));
        return;
      }
    }
  } finally {
    rl.close();
  }
}

function renderActiveInput() {
  const render = getActiveInputRender();
  if (typeof render === 'function') {
    render();
  }
}

function readInteractiveLine({ prompt, suggestions = false }) {
  return new Promise((resolve) => {
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();

    let buffer = '';
    let selectedIndex = 0;
    let viewportStart = 0;
    let renderedSuggestionLines = 0;
    let cleanedUp = false;

    const visibleSuggestionLimit = 8;

    const commandIsComplete = () => suggestions && isCompleteCommand(buffer);

    const currentSuggestions = () => {
      if (!suggestions || commandIsComplete()) {
        return [];
      }

      return commandSuggestions(buffer, 80);
    };

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      clearActiveInputRender();
      input.off('keypress', onKeypress);
      input.setRawMode(false);
    };

    const clearRenderedBlock = () => {
      output.write('\r\x1b[0J');
    };

    const render = () => {
      const matches = currentSuggestions();
      if (selectedIndex >= matches.length) {
        selectedIndex = Math.max(0, matches.length - 1);
      }
      if (selectedIndex < viewportStart) {
        viewportStart = selectedIndex;
      }
      if (selectedIndex >= viewportStart + visibleSuggestionLimit) {
        viewportStart = selectedIndex - visibleSuggestionLimit + 1;
      }

      const visible = matches.slice(viewportStart, viewportStart + visibleSuggestionLimit);
      const lines = visible.map((match, index) => {
        const actualIndex = viewportStart + index;
        const marker = actualIndex === selectedIndex ? '>' : ' ';
        const command = truncateText(match, Math.max(10, terminalWidth(output) - 4));
        return ` ${marker} ${colorize(command, 'red')}`;
      });

      if (matches.length > visible.length) {
        lines.push(`   ${matches.length - visible.length} more matches`);
      }
      if (lines.length) {
        lines.push('   Up/Down move  Tab select  Enter run');
      }

      const inputText = commandIsComplete() ? colorize(buffer, 'red') : buffer;

      clearRenderedBlock();
      output.write(`${prompt}${inputText}`);
      if (lines.length) {
        output.write(`\n${lines.join('\n')}`);
        const cursorColumn = visibleTextLength(prompt) + buffer.length;
        output.write(`\x1b[${lines.length}A\r\x1b[${cursorColumn}C`);
      }
      renderedSuggestionLines = lines.length;
    };

    const finish = (value) => {
      const matches = currentSuggestions();
      clearRenderedBlock();
      const inputText = suggestions && isCompleteCommand(value) ? colorize(value, 'red') : value;
      output.write(`${prompt}${inputText}\n`);
      void matches;
      cleanup();
      resolve(value);
    };

    const selectSuggestion = () => {
      const matches = currentSuggestions();
      if (!matches.length) {
        return;
      }

      buffer = matches[selectedIndex] || matches[0];
      selectedIndex = 0;
      viewportStart = 0;
    };

    const onKeypress = (text, key = {}) => {
      const name = resolveKeyName(text, key);
      if (key.ctrl && (name === 'c' || text === '\x03')) {
        finish('exit');
        return;
      }

      if (name === 'return' || name === 'enter') {
        finish(buffer);
        return;
      }

      if (suggestions && name === 'tab') {
        selectSuggestion();
        render();
        return;
      }

      const matches = currentSuggestions();
      if (suggestions && name === 'down' && matches.length) {
        selectedIndex = (selectedIndex + 1) % matches.length;
        render();
        return;
      }

      if (suggestions && name === 'up' && matches.length) {
        selectedIndex = selectedIndex <= 0 ? matches.length - 1 : selectedIndex - 1;
        render();
        return;
      }

      if (name === 'backspace') {
        if (buffer.length === 0) {
          return;
        }
        buffer = buffer.slice(0, -1);
        selectedIndex = 0;
        viewportStart = 0;
        const needsFullRender = renderedSuggestionLines > 0 || currentSuggestions().length > 0;
        if (needsFullRender) {
          render();
        } else {
          output.write('\b \b');
        }
        return;
      }

      if (name === 'delete') {
        render();
        return;
      }

      if (name === 'escape') {
        selectedIndex = 0;
        viewportStart = 0;
        render();
        return;
      }

      if (text && !key.ctrl && !key.meta && text >= ' ') {
        buffer += text;
        selectedIndex = 0;
        viewportStart = 0;
        const needsFullRender = renderedSuggestionLines > 0 || currentSuggestions().length > 0;
        if (needsFullRender) {
          render();
        } else {
          output.write(text);
        }
      }
    };

    setActiveInputRender(render);
    input.on('keypress', onKeypress);
    render();
  });
}

async function handleHydraCommand(parts, ask = askFromProcess) {
  if (!Array.isArray(parts)) {
    parts = tokenizeCommand(String(parts || ''));
  }

  if (String(parts[0] || '').toLowerCase() !== '/hydra') {
    console.log(systemLine(`Unknown command "${parts.join(' ')}". Try /hydra help.`, 'yellow'));
    return false;
  }

  const subcommand = String(parts[1] || 'help').toLowerCase();

  if (subcommand === 'help') {
    printHelp();
    return false;
  }

  if (subcommand === 'commands') {
    printCommands();
    return false;
  }

  if (subcommand === 'doctor') {
    await runDoctor();
    return false;
  }

  if (subcommand === 'complete') {
    printCompletions(parts.slice(2).join(' '));
    return false;
  }

  if (subcommand === 'heads') {
    printHeads();
    return false;
  }

  if (subcommand === 'roles') {
    await handleRolesCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'nicknames') {
    printNicknames();
    return false;
  }

  if (subcommand === 'who') {
    printWho(parts[2]);
    return false;
  }

  if (subcommand === 'head') {
    await handleHeadCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'auth') {
    await handleAuthCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'status') {
    printStatus();
    return false;
  }

  if (subcommand === 'resume') {
    handleResumeCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'clear' || subcommand === 'reset') {
    await handleClearCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'compact' || subcommand === 'summarize') {
    handleCompactCommand();
    return false;
  }

  if (subcommand === 'fork') {
    handleForkCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'side') {
    await handleSideCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'config') {
    handleConfigCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'mode') {
    handleModeCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'workflow') {
    handleWorkflowCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'lead') {
    await handleLeadCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'chat') {
    handleChatCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'memory') {
    await handleMemoryCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'budget') {
    await handleBudgetCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'decide') {
    await handleDecideCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'permissions-all') {
    await handlePermissionsAllCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'permissions') {
    await handlePermissionsCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'models') {
    printModels();
    return false;
  }

  if (subcommand === 'accounts' || subcommand === 'providers-auth') {
    printAuthStatus();
    return false;
  }

  if (subcommand === 'providers') {
    printProviders();
    return false;
  }

  if (subcommand === 'allow') {
    handleAllowCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'deny') {
    handleDenyCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'native' || subcommand === 'passthrough') {
    await handleNativeCommand(parts.slice(2));
    return false;
  }

  if (subcommand === 'claude-code') {
    await handleNativeCommand(['claude', ...parts.slice(2)]);
    return false;
  }

  if (subcommand === 'codex-cli') {
    await handleNativeCommand(['codex', ...parts.slice(2)]);
    return false;
  }

  if (subcommand === 'setup') {
    await handleSetupCommand(ask, parts.slice(2), { printAuthStatus, ensureSubscriptionAgreement });
    return false;
  }

  if (subcommand === 'oracle') {
    await handleOracleCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'orchestration') {
    await handleOrchestrationCommand(parts.slice(2), ask);
    return false;
  }

  if (subcommand === 'exit' || subcommand === 'quit') {
    console.log(systemLine('Session closed.', 'green'));
    return true;
  }

  if (subcommand === 'advisor' || subcommand === 'advise') {
    await handleRoleCommand(ROLE_COMMANDS.advisor, parts.slice(2), ask);
    return false;
  }

  if (ROLE_COMMANDS[subcommand]) {
    await handleRoleCommand(ROLE_COMMANDS[subcommand], parts.slice(2), ask);
    return false;
  }

  const directHead = findDirectHead(subcommand);
  if (directHead) {
    const parsed = parseHeadPromptArgs(parts.slice(2), directHead.id);
    const prompt = parsed.prompt;
    if (!prompt) {
      if (parsed.role || parsed.model) {
        saveHeadProviderDefaults(directHead.id, parsed);
        return false;
      }

      console.log(formatProviderCommandHelp(directHead.id));
      return false;
    }

    await routePrompt({
      prompt,
      requestedHeads: [directHead.id],
      mode: 'solo',
      ask,
      withContextEntries: resolveWithContextEntries(parsed.withHeads),
      providerCommand: {
        role: parsed.role?.key || null,
        model: parsed.model?.model || null,
      },
    });
    return false;
  }

  console.log(systemLine(`Unknown command "${parts.join(' ')}". Try /hydra help.`, 'yellow'));
  return false;
}

async function handleAdvisorCommand(argsForAdvisor, ask) {
  const parsed = parseUsefulHeadPromptArgs(argsForAdvisor, 'claude');
  if (!parsed.prompt) {
    console.log(systemLine('Missing prompt. Use /hydra advisor [opus|sonnet|haiku] "your request".', 'yellow'));
    return;
  }

  const defaultModel = resolveHeadModel('claude', 'opus');
  await routePrompt({
    prompt: parsed.prompt,
    requestedHeads: ['claude'],
    mode: 'solo',
    ask,
    withContextEntries: resolveWithContextEntries(parsed.withHeads),
    providerCommand: {
      role: 'advisor',
      model: (parsed.model || defaultModel)?.model || null,
    },
  });
}

async function ask(rawArgs) {
  const requestedHeads = parseWithHeads(rawArgs);
  const prompt = parsePrompt(rawArgs);

  if (!prompt) {
    throw new Error('Missing prompt. Use --prompt "your request".');
  }

  ensureProjectState();
  await routePrompt({ prompt, requestedHeads, mode: requestedHeads.includes('all') ? 'parallel' : 'explicit' });
}

async function routePromptForCurrentMode(prompt, ask = askFromProcess) {
  const adhoc = parseAdhocAddressing(prompt);
  if (adhoc) {
    return routePrompt({ prompt: adhoc.prompt, requestedHeads: [adhoc.headId], mode: 'solo', ask });
  }

  if (splitTrackHeads?.length) {
    return routePrompt({ prompt, requestedHeads: splitTrackHeads, mode: 'parallel', ask });
  }

  let config = readProjectConfig();
  let mode = config.mode || { type: 'auto', head: null };

  if (isWorkflowMode(config, mode)) {
    return routePromptWorkflow({ prompt, ask, workflow: config.workflow });
  }

  if (mode.type !== 'parallel') {
    const lead = await ensureLeadSelected(ask);
    if (lead) {
      config = readProjectConfig();
      mode = config.mode || { type: 'auto', head: null };
    }
  }

  if (mode.type === 'solo' && mode.head) {
    return routePrompt({ prompt, requestedHeads: [mode.head], mode: 'solo', ask });
  }

  if (mode.type === 'parallel') {
    return routePrompt({ prompt, requestedHeads: ['all'], mode: 'parallel', ask });
  }

  return routePrompt({ prompt, requestedHeads: ['all'], mode: 'auto', ask });
}

async function routePromptWorkflow({ prompt, ask, workflow }) {
  const normalized = normalizeWorkflow(workflow);
  if (!isCodingPrompt(prompt)) {
    if (!normalized.chat_head) {
      console.log(systemLine('Workflow chat has no available head. Assign a head the chat role or set /hydra mode auto.', 'yellow'));
      return;
    }
    return routePrompt({
      prompt,
      requestedHeads: [normalized.chat_head],
      mode: 'workflow-chat',
      ask,
    });
  }

  if (!normalized.code_head) {
    console.log(systemLine('Workflow coding has no available code head. Assign a head the code role or set /hydra mode auto.', 'yellow'));
    return;
  }

  await routePrompt({
    prompt,
    requestedHeads: [normalized.code_head],
    mode: 'workflow-code',
    ask,
    providerCommand: {
      role: normalized.code_role,
      model: null,
    },
  });

  const codeContext = resolveWithContextEntries([normalized.code_head]);
  if (!codeContext.length) {
    console.log(systemLine(`Workflow advisor skipped because ${normalized.code_head} did not return usable context.`, 'yellow'));
    return;
  }

  if (!normalized.advisor_head) {
    console.log(systemLine('Workflow advisor skipped because no advisor head is available.', 'yellow'));
    return;
  }

  const advisorPrompt = [
    'Act as the configured coding advisor.',
    'Review the coding head response for correctness, risks, architecture tradeoffs, missing tests, and concrete next changes.',
    'Do not rewrite everything unless necessary. Give concise, actionable advice.',
    '',
    `Original user request: ${prompt}`,
  ].join('\n');

  return routePrompt({
    prompt: advisorPrompt,
    requestedHeads: [normalized.advisor_head],
    mode: 'workflow-advisor',
    ask,
    withContextEntries: codeContext,
    providerCommand: {
      role: normalized.advisor_role,
      model: normalized.advisor_model,
    },
  });
}

function isWorkflowMode(config, mode = config.mode || {}) {
  return Boolean(config.workflow?.enabled) || mode.type === 'workflow';
}

function normalizeWorkflow(workflow = {}) {
  const codeRole = normalizeWorkflowRole(workflow.code_role, 'code');
  const advisorRole = normalizeWorkflowRole(workflow.advisor_role, 'advisor');
  return {
    enabled: Boolean(workflow.enabled),
    chat_head: resolveWorkflowHeadId(workflow.chat_head, ['chat', 'assistant'], ['gemini', 'codex', 'claude']),
    code_head: resolveWorkflowHeadId(workflow.code_head, [codeRole, 'code', 'builder', 'coder', 'coding'], ['codex', 'gemini', 'claude']),
    code_role: codeRole,
    advisor_head: resolveWorkflowHeadId(workflow.advisor_head, [advisorRole, 'advisor', 'advise'], ['claude', 'codex', 'gemini']),
    advisor_role: advisorRole,
    advisor_model: workflow.advisor_model || 'claude-opus-4-7',
  };
}

function resolveWorkflowHeadId(explicitHead, roleNames, preferredOrder, heads = listHeads()) {
  const explicit = String(explicitHead || '').trim().toLowerCase();
  if (explicit && heads.some((head) => head.id === explicit)) {
    return explicit;
  }

  const configured = findHeadByRoleNames(roleNames, heads);
  if (configured) {
    return configured.id;
  }

  const preferred = firstCallableHead(heads, preferredOrder);
  if (preferred) {
    return preferred.id;
  }

  return heads[0]?.id || null;
}

function normalizeWorkflowRole(value, fallback) {
  const aliases = {
    builder: 'code',
    reviewer: 'review',
    researcher: 'research',
    writer: 'write',
    tester: 'test',
    security: 'secure',
  };
  const normalized = normalizeCommandName(value || fallback);
  const mapped = aliases[normalized] || normalized;
  return resolveHeadRole(mapped) ? mapped : fallback;
}

function workflowSummary(workflow) {
  return `chat ${workflow.chat_head}; coding ${workflow.code_head} + ${workflow.advisor_head} ${workflow.advisor_role} ${workflow.advisor_model}`;
}

function isCodingPrompt(prompt) {
  const value = String(prompt || '').toLowerCase();
  const codingPatterns = [
    /\b(code|coding|program|implement|build|fix|debug|refactor|test|tests|unit test|integration test)\b/,
    /\b(error|exception|stack trace|bug|regression|compile|lint|typecheck|typescript|javascript|node|npm)\b/,
    /\b(file|function|class|module|component|api|endpoint|database|schema|migration)\b/,
    /\b(commit|diff|patch|repo|repository|pull request|pr|merge)\b/,
    /```/,
    /\b(src|lib|app|frontend|backend|server|client)\//,
  ];
  return codingPatterns.some((pattern) => pattern.test(value));
}

async function routePrompt({
  prompt,
  requestedHeads,
  mode = 'explicit',
  ask = askFromProcess,
  withContextEntries = [],
  providerCommand = {},
  recordHistory = true,
}) {
  const heads = resolveHeads(requestedHeads);
  const connected = detectConnectedHeads();
  const connectedById = new Map(connected.map((head) => [head.id, head]));
  const budgetGate = await enforceBudgetBeforePrompt({ heads, ask });
  if (budgetGate.endSession) {
    return { endSession: true };
  }
  const allowedHeads = budgetGate.heads;
  const suppressDashboardLogs = isDashboardActive();

  writeTaskLog({
    type: 'prompt.received',
    prompt,
    mode,
    heads: allowedHeads.map((head) => head.id),
    withContextHeads: withContextEntries.map((entry) => entry.head),
  });

  if (mode === 'parallel') {
    return await routePromptParallel({ prompt, heads: allowedHeads, connected, connectedById, ask, withContextEntries, recordHistory });
  }

  for (const head of allowedHeads) {
    const status = applyProviderCommandToStatus(connectedById.get(head.id), providerCommand);
    const effectiveHead = { ...head, ...status, model: status?.model || head.defaultModel, role: status?.role || null };
    if (!suppressDashboardLogs) {
      console.log('');
      console.log(formatActiveHeadHeader(effectiveHead));
    }

    if (!status?.connected) {
      if (!suppressDashboardLogs) {
        console.log(systemLine(`${effectiveHead.name} is not connected. Set ${effectiveHead.envKey} in .env or your shell environment.`, 'yellow'));
      }
      continue;
    }

    if (!status.callable) {
      if (!suppressDashboardLogs) {
        console.log(systemLine(`${effectiveHead.name} is configured for subscription usage. API calls require api-key mode until a provider-approved subscription interface is added.`, 'yellow'));
      }
      continue;
    }

    const result = await sendPromptToHead({
      head: effectiveHead,
      status,
      prompt,
      connectedHeads: connected,
      withContextEntries,
      enableTools: true,
      stream: mode === 'solo' && !isDashboardActive(),
      ask,
      recordHistory,
    });
    displayHeadResult(effectiveHead, result);
    if (recordHistory) {
      await maybeTriggerWithContextDecision({ result, prompt, withContextEntries, ask });
    }
    const threshold = await handleBudgetThresholdIfNeeded({ ask });
    if (threshold?.endSession) {
      return { endSession: true };
    }
  }
}

async function routePromptParallel({ prompt, heads, connected, connectedById, ask, withContextEntries = [], recordHistory = true }) {
  const jobs = [];
  const deferredResults = [];
  const queuedAsk = createQueuedAsk(ask);
  const dashboardPromise = input.isTTY && output.isTTY && !isDashboardActive()
    ? runDashboard({ autoCloseOnIdle: true })
    : null;
  const suppressLogs = Boolean(dashboardPromise);

  for (const head of heads) {
    const status = connectedById.get(head.id);
    const effectiveHead = { ...head, ...status, model: status?.model || head.defaultModel, role: status?.role || null };
    if (!status.connected) {
      if (!suppressLogs) console.log(`${formatHeadStatusLine(effectiveHead)} | SKIPPED: not connected`);
      continue;
    }

    if (!status.callable) {
      if (!suppressLogs) console.log(`${formatHeadStatusLine(effectiveHead)} | SKIPPED: subscription mode`);
      continue;
    }

    if (!suppressLogs) console.log(`${formatHeadStatusLine(effectiveHead)} | Working...`);
    jobs.push(
      sendPromptToHead({
        head: effectiveHead,
        status,
        prompt,
        connectedHeads: connected,
        withContextEntries,
        enableTools: true,
        ask: queuedAsk,
        recordHistory,
      }).then((result) => {
        if (suppressLogs) {
          deferredResults.push({ head: effectiveHead, result });
        } else {
          const label = result.ok ? 'Done' : 'Failed';
          console.log(`${formatHeadStatusLine(effectiveHead)} | ${label}`);
          displayHeadResult(effectiveHead, result);
        }
        return result;
      }),
    );
  }

  const results = await Promise.all(jobs);
  if (dashboardPromise) {
    closeActiveDashboard('all-done');
    await dashboardPromise;
    for (const { head: deferredHead, result } of deferredResults) {
      const label = result.ok ? 'Done' : 'Failed';
      console.log(`${formatHeadStatusLine(deferredHead)} | ${label}`);
      displayHeadResult(deferredHead, result);
    }
  }
  if (recordHistory) {
    for (const result of results) {
      await maybeTriggerWithContextDecision({ result, prompt, withContextEntries, ask });
    }
    await maybeTriggerDecisionPrompt({ results, prompt, connectedById, ask });
  }
  const threshold = await handleBudgetThresholdIfNeeded({ ask });
  if (threshold?.endSession) {
    return { endSession: true };
  }
}

function createQueuedAsk(ask) {
  let queue = Promise.resolve();
  return (question) => {
    const next = queue.then(() => ask(question));
    queue = next.catch(() => {});
    return next;
  };
}

async function sendPromptToHead({ head, status, prompt, connectedHeads, withContextEntries = [], enableTools = false, stream = false, ask = askFromProcess, recordHistory = true }) {
  const streamRequested = Boolean(stream) && status.authMode === 'subscription' && status.callable;
  try {
    if (!status.callable) {
      throw new Error(`${head.name} is not callable in ${status.authMode} mode.`);
    }

    const builtContext = buildSystemContext({
      head,
      prompt,
      connectedHeads,
    });

    writeTaskLog({
      type: 'prompt.context_built',
      head: head.id,
      pinnedCount: builtContext.metadata.pinnedCount,
      recentDecisionCount: builtContext.metadata.recentDecisionCount,
      relevantMemoryCount: builtContext.metadata.relevantMemoryCount,
    });

    const headPromptContext = formatHeadPromptContext(head.prompt);
    const roleContext = headPromptContext ? '' : formatRoleContext(head.role);
    const injectedContext = formatWithContextBlock(withContextEntries);
    const nativeToolContext = formatNativeToolContext(status);
    const transcriptContext = formatTranscriptContext(head.id);
    const context = [roleContext, headPromptContext, injectedContext, nativeToolContext, transcriptContext, builtContext.context].filter(Boolean).join('\n\n');

    if (injectedContext) {
      writeTaskLog({
        type: 'prompt.with_context_injected',
        head: head.id,
        injectedHeads: withContextEntries.map((entry) => entry.head),
      });
    }

    if (head.role) {
      writeTaskLog({
        type: 'prompt.role_injected',
        head: head.id,
        role: head.role,
      });
    }

    const adapter = createHeadAdapter(status);
    const toolsEnabled = enableTools
      && status.authMode !== 'subscription';
    const sendOptions = toolsEnabled
      ? {
          tools: getToolDefinitions(),
          executeTool: ({ name, input }) => executeTool({ name, input, head: head.id, ask }),
        }
      : {};

    if (streamRequested) {
      sendOptions.onChunk = (chunk) => process.stdout.write(chunk);
    }

    if (typeof adapter.abort === 'function') {
      setCurrentAbortable(() => adapter.abort());
    }

    markStart(head.id, { role: head.role, model: status.model, prompt });
    let response;
    try {
      response = await adapter.sendPrompt(context, prompt, streamRequested, sendOptions);
    } finally {
      clearCurrentAbortable();
    }

    if (streamRequested) {
      process.stdout.write('\n');
    }
    setHealth(head.id, { verified: true, error: null });
    const tokens = extractResponseTokens(response);
    markEnd(head.id, {
      tokens: tokens.total || tokens.output || null,
      preview: (response.text || '').slice(0, 120),
      text: response.text || '',
      prompt,
      model: response.model,
    });
    const budget = await recordBudgetUsage({
      head: head.id,
      model: response.model,
      tokens,
    });
    writeTaskLog({
      type: 'prompt.completed',
      head: head.id,
      model: response.model,
      estimatedTokens: response.estimatedTokens,
      estimatedCostUsd: response.estimatedCostUsd,
      budgetCostUsd: budget.cost,
    });
    if (recordHistory) {
      rememberHeadResponse({
        head: head.id,
        prompt,
        content: response.text || '',
      });
      recordExchange(head.id, prompt, response.text || '');
    }
    return {
      ok: true,
      head: head.id,
      response,
      text: response.text || '',
      streamed: Boolean(streamRequested),
    };
  } catch (error) {
    const reason = sanitizeErrorMessage(error);
    setHealth(head.id, { verified: false, error: reason });
    markEnd(head.id, { error: reason, prompt });
    writeTaskLog({
      type: 'prompt.failed',
      head: head.id,
      reason,
    });
    return {
      ok: false,
      head: head.id,
      response: null,
      text: '',
      error: reason,
    };
  }
}

function formatNativeToolContext(status) {
  const base = [
    'HYDRA NATIVE CLI BRIDGE [injected automatically by Hydra]',
    '',
    'Claude Code and Codex CLI commands are available through Hydra.',
  ];

  if (status?.authMode === 'subscription') {
    return [
      ...base,
      'This head is running inside a provider CLI. Use the provider CLI shell/tooling to run:',
      '- hydra native claude ...',
      '- hydra native codex ...',
      'Examples: hydra native claude doctor | hydra native codex exec --help',
    ].join('\n');
  }

  return [
    ...base,
    'When tool calling is available, use the `run_native_cli` tool.',
    'Use `provider` as `claude` or `codex`, `args` for CLI arguments, or `prompt` to route a headless prompt through that native CLI.',
    'Examples: provider=claude args=["doctor"]; provider=codex args=["mcp","list"]; provider=codex prompt="Review this implementation."',
  ].join('\n');
}

function displayHeadResult(head, result) {
  if (result.streamed && result.ok) {
    return;
  }
  if (isDashboardActive()) {
    return;
  }

  console.log('');
  console.log(formatActiveHeadHeader(head));

  if (!result.ok) {
    const reason = result.error ? ` reason: ${result.error}` : '';
    console.log(systemLine(`${head.name} request failed.${reason} Run /hydra doctor to test the connection.`, 'yellow'));
    return;
  }

  console.log(result.text || '[empty response]');
}

async function maybeTriggerDecisionPrompt({ results, prompt, connectedById, ask }) {
  const successful = results
    .filter((result) => result.ok && result.text.trim())
    .map((result) => ({
      head: result.head,
      content: result.text,
    }));

  if (successful.length < 2) {
    return;
  }

  rememberParallelResponses(prompt, successful);
  if (!responsesAreDifferent(successful)) {
    return;
  }

  const decision = createPendingDecision(prompt, successful);
  const decisionResult = await showDecisionPrompt(successful, prompt, ask, {
    adapters: createDecisionAdapters(successful, connectedById),
    decision,
  });
  applyDecisionResult(decisionResult);
}

async function maybeTriggerWithContextDecision({ result, prompt, withContextEntries, ask }) {
  if (!result.ok || !result.text.trim() || !withContextEntries.length) {
    return;
  }

  for (const entry of withContextEntries) {
    const comparison = [
      { head: entry.head, content: entry.content },
      { head: result.head, content: result.text },
    ];

    if (!responsesAreDifferent(comparison)) {
      continue;
    }

    const decision = createPendingDecision(prompt, comparison);
    const decisionResult = await showDecisionPrompt(comparison, prompt, ask, {
      adapters: createDecisionAdaptersForCurrentHeads(comparison),
      decision,
    });
    applyDecisionResult(decisionResult);
    return;
  }
}

function createDecisionAdapters(responses, connectedById) {
  const adapters = new Map();
  for (const response of responses) {
    const status = connectedById.get(response.head);
    if (status?.callable) {
      adapters.set(response.head, createHeadAdapter(status));
    }
  }

  return adapters;
}

function createDecisionAdaptersForCurrentHeads(responses) {
  const connectedById = new Map(detectConnectedHeads().map((head) => [head.id, head]));
  return createDecisionAdapters(responses, connectedById);
}

function applyDecisionResult(decisionResult) {
  if (decisionResult?.action === 'split') {
    splitTrackHeads = decisionResult.heads;
  }
}

function printCompletions(prefix) {
  const value = prefix || '/hydra ';
  const [hits] = hydraCompleter(value);
  const matches = hits.length ? hits : completionCandidates(value).filter((candidate) => candidate.includes(value));
  if (!matches.length) {
    console.log(systemLine('No matching commands.'));
    return;
  }

  console.log('[HYDRA] COMPLETIONS');
  console.log('');
  for (const match of matches.slice(0, 40)) {
    console.log(match);
  }

  if (matches.length > 40) {
    console.log(`...and ${matches.length - 40} more`);
  }
}

async function handleNativeCommand(argsForNative) {
  const provider = argsForNative[0];
  if (!provider) {
    console.log(formatNativeCommandHelp());
    return;
  }

  const code = await runNativeCommand({
    provider,
    args: argsForNative.slice(1),
  });
  if (code !== 0) {
    process.exitCode = code;
  }
}

function applyProviderCommandToStatus(status, providerCommand = {}) {
  if (!status) {
    return status;
  }

  return {
    ...status,
    model: providerCommand.model || status.model,
    role: providerCommand.role || status.role || null,
  };
}

function printStatus() {
  const config = readProjectConfig();
  const heads = detectConnectedHeads();
  const connectedCount = heads.filter((head) => head.connected).length;
  const mode = config.mode?.type === 'solo'
    ? `solo ${config.mode.head}`
    : config.mode?.type || 'auto';
  const workflow = normalizeWorkflow(config.workflow);

  console.log(systemLine('Status'));
  console.log(`Mode:        ${mode}`);
  console.log(`Workflow:    ${workflow.enabled ? workflowSummary(workflow) : 'OFF'}`);
  console.log(`Heads:       ${connectedCount}/${heads.length} connected, ${heads.filter((head) => head.callable).length}/${heads.length} callable`);
  console.log(`Budget:      ${config.budget.enabled ? `ON ${formatUsd(config.budget.limit_usd)}` : 'OFF'}`);
  console.log(`Permissions: ${getPermissionState().definition.label}`);
  console.log(`Session:     ${sessionTranscript.length} exchange${sessionTranscript.length === 1 ? '' : 's'} loaded`);
  console.log('');
  printConfiguredHeadsBlock(heads);
}

function printConfiguredHeadsBlock(heads = detectConnectedHeads()) {
  console.log('Configured heads:');
  heads.forEach((head, index) => {
    printHeadStatusBlock(head, index);
    if (index < heads.length - 1) {
      console.log('');
    }
  });
}

function printLeadStatus(config = readProjectConfig(), heads = detectConnectedHeads()) {
  const current = config.mode?.type === 'solo' ? config.mode.head : null;
  const target = current ? heads.find((head) => head.id === current) : null;
  console.log(`Lead head: ${target ? `${target.id} (${target.name})` : '(none - plain prompts broadcast)'}`);
  console.log(`Available: ${heads.map((head) => head.id).join(', ') || 'none'}`);
  console.log('Usage: /lead <head-id> | /lead none');
}

function setLeadHead(target) {
  splitTrackHeads = null;
  updateProjectConfig((config) => {
    config.mode = { type: 'solo', head: target };
    return config;
  });
  writeTaskLog({ type: 'mode.lead_selected', head: target, source: 'lead_command' });
  console.log(systemLine(`Lead set to ${target}. Plain prompts will route there.`, 'green'));
}

async function promptLeadHeadSelection(ask = askFromProcess) {
  const heads = detectConnectedHeads();
  if (heads.length === 0) {
    console.log(systemLine('No heads configured. Run /setup head new first.', 'yellow'));
    return;
  }

  const labels = [
    ...heads.map((head, index) => {
      const callable = head.callable ? 'ready' : 'not callable';
      return `Head ${index + 1}: ${head.id} - ${head.name} (${formatHeadShortLabel(head)}, ${callable})`;
    }),
    'None - broadcast/plain auto routing',
  ];
  const index = await promptMenuChoice(ask, 'Lead head', labels, 0);
  if (index === MENU_BACK || index === null) {
    console.log(systemLine('Lead unchanged.', 'yellow'));
    return;
  }
  if (index === heads.length) {
    clearLeadHead();
    return;
  }
  const chosen = heads[index];
  if (!chosen.callable) {
    console.log(systemLine(`${chosen.name} is not callable yet. Lead is set, but plain prompts may fail until it is connected.`, 'yellow'));
  }
  setLeadHead(chosen.id);
}

function clearLeadHead() {
  splitTrackHeads = null;
  updateProjectConfig((config) => {
    config.mode = { type: 'auto', head: null };
    return config;
  });
  writeTaskLog({ type: 'mode.lead_cleared' });
  console.log(systemLine('Lead cleared. Plain prompts will broadcast to all heads.', 'green'));
}

function handleModeCommand(argsForMode) {
  const mode = argsForMode[0];

  if (mode === 'auto') {
    splitTrackHeads = null;
    updateProjectConfig((config) => {
      config.mode = { type: 'auto', head: null };
      return config;
    });
    console.log(systemLine('Mode set to auto.', 'green'));
    return;
  }

  if (mode === 'parallel') {
    splitTrackHeads = null;
    updateProjectConfig((config) => {
      config.mode = { type: 'parallel', head: null };
      return config;
    });
    console.log(systemLine('Mode set to parallel.', 'green'));
    return;
  }

  if (mode === 'workflow') {
    setDefaultWorkflow(true);
    console.log(systemLine('Workflow mode set: normal chat -> Gemini; coding -> Codex code role + Claude advisor role.', 'green'));
    return;
  }

  if (mode === 'solo') {
    splitTrackHeads = null;
    const headId = argsForMode[1];
    if (!headId) {
      console.log(systemLine(`Usage: /hydra mode solo <head-id> (${listHeads().map((head) => head.id).join(', ')})`, 'yellow'));
      return;
    }

    try {
      resolveHeads([headId]);
    } catch (error) {
      console.log(systemLine(error.message, 'yellow'));
      return;
    }

    updateProjectConfig((config) => {
      config.mode = { type: 'solo', head: headId.toLowerCase() };
      return config;
    });
    console.log(systemLine(`Mode set to solo ${headId.toLowerCase()}.`, 'green'));
    return;
  }

  console.log(systemLine('Usage: /hydra mode auto | /hydra mode workflow | /hydra mode solo <head-id> | /hydra mode parallel', 'yellow'));
}

function handleWorkflowCommand(argsForWorkflow) {
  const action = String(argsForWorkflow[0] || 'status').toLowerCase();

  if (action === 'on' || action === 'default') {
    const workflow = setDefaultWorkflow(true);
    console.log(systemLine(`Workflow enabled: ${workflowSummary(workflow)}.`, 'green'));
    return;
  }

  if (action === 'off' || action === 'none') {
    updateProjectConfig((config) => {
      config.workflow = {
        ...normalizeWorkflow(config.workflow),
        enabled: false,
      };
      config.mode = { type: 'auto', head: null };
      return config;
    });
    writeTaskLog({ type: 'workflow.disabled' });
    console.log(systemLine('Workflow disabled. Plain prompts use normal mode routing.', 'green'));
    return;
  }

  if (action === 'status' || action === 'show') {
    const workflow = normalizeWorkflow(readProjectConfig().workflow);
    console.log('[HYDRA] WORKFLOW');
    console.log(`Enabled:      ${workflow.enabled}`);
    console.log(`Normal chat:  ${workflow.chat_head}`);
    console.log(`Coding:       ${workflow.code_head} (${workflow.code_role})`);
    console.log(`Advisor:      ${workflow.advisor_head} (${workflow.advisor_role}, ${workflow.advisor_model})`);
    console.log('');
    console.log('/hydra workflow on');
    console.log('/hydra workflow off');
    return;
  }

  console.log(systemLine('Usage: /hydra workflow on | off | status', 'yellow'));
}

function setDefaultWorkflow(enabled) {
  let savedWorkflow = null;
  updateProjectConfig((config) => {
    const normalized = normalizeWorkflow({
      ...config.workflow,
      enabled,
      code_role: 'code',
      advisor_role: 'advisor',
      advisor_model: 'claude-opus-4-7',
    });
    config.workflow = {
      ...normalized,
      code_role: 'code',
      advisor_role: 'advisor',
      advisor_model: 'claude-opus-4-7',
    };
    savedWorkflow = config.workflow;
    if (enabled) {
      config.mode = { type: 'workflow', head: null };
    }
    return config;
  });
  writeTaskLog({
    type: enabled ? 'workflow.enabled' : 'workflow.disabled',
    chat_head: savedWorkflow?.chat_head || null,
    code_head: savedWorkflow?.code_head || null,
    advisor_head: savedWorkflow?.advisor_head || null,
    advisor_role: savedWorkflow?.advisor_role || 'advisor',
    advisor_model: savedWorkflow?.advisor_model || 'claude-opus-4-7',
  });
  return savedWorkflow;
}

async function handleLeadCommand(argsForLead, ask = askFromProcess) {
  const target = (argsForLead[0] || '').toLowerCase();

  if (!target || target === 'status' || target === 'show') {
    const config = readProjectConfig();
    const heads = detectConnectedHeads();
    printLeadStatus(config, heads);
    if (!target && canUseInteractiveMenu()) {
      await promptLeadHeadSelection(ask);
    }
    return;
  }

  if (target === 'pick' || target === 'choose' || target === 'select') {
    await promptLeadHeadSelection(ask);
    return;
  }

  if (target === 'none' || target === 'off' || target === 'auto') {
    clearLeadHead();
    return;
  }

  let resolved;
  try {
    resolved = resolveHeads([target])[0];
  } catch (error) {
    console.log(systemLine(error.message, 'yellow'));
    printLeadStatus();
    return;
  }

  const connected = detectConnectedHeads().find((head) => head.id === resolved.id);
  if (connected && !connected.callable) {
    console.log(systemLine(`${connected.name} is not callable yet. Lead is set, but plain prompts may fail until it is connected.`, 'yellow'));
  }
  setLeadHead(resolved.id);
}

function handleChatCommand(argsForChat) {
  const action = (argsForChat[0] || '').toLowerCase();

  if (!action || action === 'status' || action === 'show') {
    if (sessionTranscript.length === 0) {
      console.log('Conversation transcript is empty for this session.');
      return;
    }
    console.log(`Conversation transcript (last ${sessionTranscript.length} exchange${sessionTranscript.length === 1 ? '' : 's'}):`);
    for (const entry of sessionTranscript) {
      console.log(`  USER -> ${entry.headId.toUpperCase()}: ${truncateText(entry.prompt, 80)}`);
      console.log(`  ${entry.headId.toUpperCase()}: ${truncateText(entry.response, 80)}`);
    }
    return;
  }

  if (action === 'clear' || action === 'reset') {
    clearTranscript();
    deleteTranscriptFromDisk();
    writeTaskLog({ type: 'chat.transcript_cleared' });
    console.log(systemLine('Conversation transcript cleared.', 'green'));
    return;
  }

  if (action === 'save') {
    const target = argsForChat[1];
    const file = saveTranscriptToDisk(target);
    if (file) {
      console.log(systemLine(`Transcript saved to ${file}`, 'green'));
    } else {
      console.log(systemLine('Failed to save transcript.', 'yellow'));
    }
    return;
  }

  if (action === 'load') {
    const target = argsForChat[1];
    if (loadTranscriptFromDisk(target)) {
      console.log(systemLine(`Transcript loaded (${sessionTranscript.length} exchange${sessionTranscript.length === 1 ? '' : 's'}).`, 'green'));
    } else {
      console.log(systemLine('No transcript found at that path, or file is invalid.', 'yellow'));
    }
    return;
  }

  console.log(systemLine('Usage: /hydra chat | /hydra chat clear | /hydra chat save [file] | /hydra chat load [file]', 'yellow'));
}

function handleConfigCommand(argsForConfig) {
  const command = argsForConfig[0];

  if (!command) {
    const config = readProjectConfig();
    console.log('[HYDRA] CONFIG');
    console.log('');
    console.log(`Logo:        ${config.logo}`);
    console.log(`Mode:        ${config.mode.type}${config.mode.head ? ` ${config.mode.head}` : ''}`);
    console.log(`Workflow:    ${normalizeWorkflow(config.workflow).enabled ? workflowSummary(normalizeWorkflow(config.workflow)) : 'OFF'}`);
    console.log(`Permissions: LEVEL ${config.permissions.default_level}`);
    console.log(`Budget:      ${config.budget.enabled ? `ON ${formatUsd(config.budget.limit_usd || 0)}` : 'OFF'}`);
    console.log('');
    console.log('Provider defaults:');
    for (const head of detectConnectedHeads()) {
      const role = config.roles[head.id] || 'default';
      const model = config.models[head.id] || head.defaultModel;
      console.log(`${formatHeadStatusPrefix(head)}${colorize(head.tag, headDisplayColor(head))} role: ${role.padEnd(10)} model: ${formatModelShortName(model)} (${model || 'n/a'})`);
    }
    console.log('');
    console.log('/hydra config set logo full');
    console.log('/hydra config set logo compact');
    console.log('/hydra config set logo off');
    return;
  }

  if (command === 'set' && argsForConfig[1] === 'logo') {
    const logoMode = String(argsForConfig[2] || '').toLowerCase();
    if (!['full', 'compact', 'off'].includes(logoMode)) {
      console.log(systemLine('Usage: /hydra config set logo full | compact | off', 'yellow'));
      return;
    }

    updateProjectConfig((config) => {
      config.logo = logoMode;
      return config;
    });
    writeTaskLog({
      type: 'config.updated',
      key: 'logo',
      value: logoMode,
    });
    console.log(systemLine(`Logo mode set to ${logoMode}.`, 'green'));
    return;
  }

  console.log(systemLine('Usage: /hydra config | /hydra config set logo full | compact | off', 'yellow'));
}

function saveHeadProviderDefaults(headId, parsed) {
  const head = resolveHeads([headId])[0];
  updateProjectConfig((config) => {
    config.models = config.models || {};
    config.roles = config.roles || {};
    if (parsed.model) {
      config.models[head.id] = parsed.model.model;
    }
    if (parsed.role) {
      config.roles[head.id] = parsed.role.key;
    }
    return config;
  });

  writeTaskLog({
    type: 'provider.defaults_set',
    head: head.id,
    role: parsed.role?.key || null,
    model: parsed.model?.model || null,
  });

  const parts = [];
  if (parsed.role) {
    parts.push(`role ${parsed.role.key}`);
  }
  if (parsed.model) {
    parts.push(`model ${parsed.model.model}`);
  }
  console.log(systemLine(`${head.name} default ${parts.join(', ')} saved.`, 'green'));
  console.log(`/hydra ${head.id} "${parsed.role?.key || 'prompt'} request"`);
}

async function ensureSubscriptionAgreement(ask) {
  const config = readProjectConfig();
  if (config.subscription_agreement?.accepted) {
    return true;
  }

  console.log('');
  console.log(colorize('[CAUTION] SUBSCRIPTION MODE AGREEMENT', 'red'));
  console.log('');
  console.log('Subscription mode routes prompts to Claude and Codex through your');
  console.log('paid Claude and ChatGPT accounts. Anthropic and OpenAI document');
  console.log('that paid Claude/ChatGPT subscriptions do not include programmatic');
  console.log('API access, and their terms restrict automated use of those');
  console.log('subscriptions through third-party tools.');
  console.log('');
  console.log('Using subscription mode MAY:');
  console.log('  - violate your Anthropic and/or OpenAI terms of service');
  console.log('  - result in suspension or termination of your accounts');
  console.log('  - stop working at any time without notice');
  console.log('');
  console.log('Hydra does not store provider session tokens or scrape browser');
  console.log('sessions. Subscription calls run through official first-party CLIs');
  console.log('(claude / codex) that must be installed and signed in separately.');
  console.log('');
  console.log('Type AGREE to accept this risk and enable subscription calls.');
  console.log('Anything else cancels.');
  console.log('');

  const answer = (await ask('Decision: ')).trim();
  if (answer !== 'AGREE') {
    console.log(systemLine('Subscription agreement not accepted. Auth mode change cancelled.', 'yellow'));
    return false;
  }

  const acceptedAt = new Date().toISOString();
  updateProjectConfig((cfg) => {
    cfg.subscription_agreement = { accepted: true, accepted_at: acceptedAt };
    return cfg;
  });
  invalidateHealth();
  writeTaskLog({
    type: 'subscription.agreement_accepted',
    accepted_at: acceptedAt,
  });
  console.log(systemLine('Subscription agreement recorded.', 'green'));
  console.log('');
  return true;
}

async function handleAuthCommand(argsForAuth, ask) {
  const headId = argsForAuth[0];
  const mode = argsForAuth[1];

  if (!headId) {
    printAuthStatus();
    return;
  }

  if (headId === 'clear') {
    await handleAuthClearCommand(argsForAuth.slice(1), ask);
    return;
  }

  try {
    resolveHeads([headId]);
  } catch (error) {
    console.log(systemLine(error.message, 'yellow'));
    return;
  }

  const normalizedMode = normalizeAuthMode(mode);
  const acceptedModes = ['auto', 'api', 'api-key', 'api_key', 'subscription', 'sub', 'off', 'none'];
  if (!mode || !acceptedModes.includes(String(mode).toLowerCase())) {
    console.log(systemLine('Usage: /hydra auth claude auto | api-key | subscription | off', 'yellow'));
    return;
  }

  if (normalizedMode === 'subscription') {
    const agreed = await ensureSubscriptionAgreement(ask);
    if (!agreed) {
      return;
    }
  }

  updateProjectConfig((config) => {
    config.auth[headId.toLowerCase()] = normalizedMode;
    return config;
  });
  invalidateHealth();
  writeTaskLog({
    type: 'auth.mode_set',
    head: headId.toLowerCase(),
    mode: normalizedMode,
  });
  console.log(systemLine(`${headId.toLowerCase()} auth mode set to ${normalizedMode}.`, 'green'));
}

async function handleAuthClearCommand(argsForAuthClear, ask) {
  if (!argsForAuthClear.includes('--force')) {
    console.log(systemLine('Clearing all auth requires --force and explicit confirmation.', 'yellow'));
    console.log('/hydra auth clear --force');
    return;
  }

  console.log('[HYDRA] AUTH  CLEAR ALL');
  console.log('');
  console.log('This disconnects all heads by setting their saved auth modes to off.');
  console.log('Private API keys in .hydra-state/.env or the shell environment are not deleted.');
  console.log('');
  const answer = await ask('Clear all auth settings? [Y/N]: ');
  if (answer.trim().toLowerCase() !== 'y') {
    console.log(systemLine('Auth settings unchanged.', 'yellow'));
    return;
  }

  updateProjectConfig((config) => {
    config.auth.claude = 'off';
    config.auth.codex = 'off';
    config.auth.gemini = 'off';
    return config;
  });
  writeTaskLog({
    type: 'auth.cleared',
    mode: 'all_off',
  });
  console.log(systemLine('All saved auth modes set to off.', 'green'));
}


function printAuthStatus() {
  console.log('[HYDRA] AUTH');
  console.log('');
  for (const head of detectConnectedHeads()) {
    const callable = head.callable ? 'SDK calls enabled' : 'SDK calls disabled';
    console.log(`${formatHeadStatusPrefix(head)}${colorize(head.tag.padEnd(10), headDisplayColor(head))} ${head.connectionLabel.padEnd(14)} mode: ${head.authMode.padEnd(12)} ${callable}`);
  }
  console.log('');
  console.log('/hydra auth claude api-key');
  console.log('/hydra auth claude subscription');
  console.log('/hydra auth claude auto');
  console.log('/hydra auth claude off');
  console.log('/hydra auth clear --force');
}

async function handleRolesCommand(argsForRoles = [], ask = askFromProcess) {
  const action = String(argsForRoles[0] || '').toLowerCase();
  if (!action) {
    printRoles();
    return;
  }

  if (action === 'clear') {
    await handleRolesClearCommand(argsForRoles.slice(1), ask);
    return;
  }

  console.log(systemLine('Usage: /roles | /roles clear head 1 | /roles clear all', 'yellow'));
}

async function handleRolesClearCommand(argsForClear = [], _ask = askFromProcess) {
  const target = String(argsForClear[0] || '').toLowerCase();
  if (!target) {
    console.log(systemLine('Usage: /roles clear head 1 | /roles clear all', 'yellow'));
    return;
  }

  if (target === 'all') {
    clearRolesForHeads(listHeads());
    return;
  }

  const selector = target === 'head'
    ? argsForClear.slice(1).join(' ')
    : argsForClear.join(' ');
  const head = resolveHeadSelector(selector);
  if (!head) {
    console.log(systemLine(`Unknown head "${selector || target}". Use /heads to list configured heads.`, 'yellow'));
    return;
  }

  clearRolesForHeads([head]);
}

function clearRolesForHeads(heads) {
  const ids = heads.map((head) => head.id);
  updateProjectConfig((config) => {
    config.roles = config.roles || {};
    for (const id of ids) {
      config.roles[id] = null;
    }
    return config;
  });

  let clearedCustomDefaults = 0;
  for (const head of heads) {
    if (!head.builtin && head.defaultRole) {
      updateHeadInRegistry(head.id, { defaultRole: null });
      clearedCustomDefaults += 1;
    }
  }

  writeTaskLog({
    type: ids.length === listHeads().length ? 'roles.clear_all' : 'roles.clear_head',
    heads: ids,
    clearedCustomDefaults,
  });

  if (ids.length === 1) {
    console.log(systemLine(`Cleared role for ${ids[0]}.`, 'green'));
  } else {
    console.log(systemLine(`Cleared roles for ${ids.length} heads.`, 'green'));
  }
}

function resolveHeadSelector(selector) {
  const value = String(selector || '').trim().toLowerCase();
  if (!value) {
    return null;
  }

  const heads = listHeads();
  const ordinal = value.match(/^head\s*(\d+)$/) || value.match(/^(\d+)$/);
  if (ordinal) {
    const index = Number(ordinal[1]) - 1;
    return index >= 0 && index < heads.length ? heads[index] : null;
  }

  const normalized = normalizeCommandName(value);
  return heads.find((head) => (
    normalizeCommandName(head.id) === normalized
    || normalizeCommandName(head.name) === normalized
    || (head.aliases || []).some((alias) => normalizeCommandName(alias) === normalized)
  )) || null;
}

function printRoles() {
  console.log('[HYDRA] ROLES');
  console.log('Usage: /roles | /roles clear head 1 | /roles clear all');
  for (const group of ROLE_CATEGORIES) {
    console.log('');
    console.log(group.label);
    for (const definition of group.commands) {
      const target = resolveHeadForRole(definition);
      const route = routeSummaryForRole(definition, target);
      console.log(`  /${definition.name.padEnd(10)} ${definition.description}${route}`);
    }
  }
}

function routeSummaryForRole(definition, target) {
  if (definition.routeMode === 'all') {
    return ' -> all callable heads';
  }
  if (definition.routeMode === 'default') {
    return ' -> default routing';
  }
  return target?.head ? ` -> ${target.head.id}` : ' -> not configured';
}

function printNicknames() {
  const entries = getNicknameEntries(listHeads());
  console.log('[HYDRA] NICKNAMES');
  console.log('');
  if (!entries.length) {
    console.log('No nicknames are configured.');
    return;
  }

  for (const entry of entries) {
    const disabled = entry.reserved ? ' DISABLED: reserved command name' : '';
    console.log(`/${entry.alias.padEnd(12)} -> ${entry.head.id} (${entry.source})${disabled}`);
  }

  const conflicts = entries.filter((entry) => entry.reserved);
  if (conflicts.length) {
    console.log('');
    console.log(systemLine('Reserved nickname conflicts are ignored until renamed.', 'yellow'));
    console.log(`Reserved names include: ${getReservedCommandNames().slice(0, 12).join(', ')} ...`);
  }
}

function printWho(rawCommand) {
  if (!rawCommand) {
    console.log(systemLine('Usage: /who <command>', 'yellow'));
    console.log('Example: /who advisor');
    return;
  }

  const resolved = resolveCommandName(rawCommand, listHeads());
  if (resolved.type === 'unknown') {
    printUnknownCommand(resolved);
    return;
  }

  console.log(`[HYDRA] WHO /${resolved.command}`);
  console.log('');

  if (resolved.type === 'builtin') {
    const target = resolved.definition.aliasFor ? `/${resolved.definition.aliasFor}` : `/${resolved.definition.name}`;
    console.log('Type: built-in');
    console.log(`Runs: ${target}`);
    console.log(`Description: ${resolved.definition.description}`);
    return;
  }

  if (resolved.type === 'role') {
    const target = resolveHeadForRole(resolved.definition);
    console.log('Type: role');
    console.log(`Role: ${resolved.definition.roleKey || resolved.definition.name}`);
    if (resolved.definition.routeMode === 'all') {
      console.log('Routes to: all callable heads');
      return;
    }
    if (resolved.definition.routeMode === 'default') {
      console.log('Routes to: default Hydra routing');
      return;
    }
    console.log(`Routes to: ${target?.head?.id || 'not configured'}`);
    if (target?.head) {
      const nickname = getNicknameEntries(listHeads()).find((entry) => !entry.reserved && entry.head.id === target.head.id);
      console.log(`Nickname: ${nickname?.alias || 'none'}`);
      console.log(`Provider/model: ${formatHeadProviderModel(target.head.id)}`);
    }
    return;
  }

  if (resolved.type === 'nickname') {
    console.log('Type: nickname');
    console.log(`Routes to: ${resolved.head.id}`);
    console.log(`Nickname source: ${resolved.nickname.source}`);
    console.log(`Provider/model: ${formatHeadProviderModel(resolved.head.id)}`);
    return;
  }

  if (resolved.type === 'head') {
    console.log('Type: direct head');
    console.log(`Routes to: ${resolved.head.id}`);
    console.log(`Provider/model: ${formatHeadProviderModel(resolved.head.id)}`);
  }
}


function handleResumeCommand(argsForResume = []) {
  const name = argsForResume[0];
  const loaded = name
    ? loadTranscriptFromDisk(sessionFilePath(name))
    : loadTranscriptFromDisk();

  if (!loaded) {
    console.log(systemLine(name ? `No saved session named "${name}".` : 'No saved session found.', 'yellow'));
    return;
  }

  console.log(systemLine(`Session resumed (${sessionTranscript.length} exchange${sessionTranscript.length === 1 ? '' : 's'}).`, 'green'));
}

async function handleClearCommand(argsForClear = [], ask = askFromProcess) {
  const force = argsForClear.includes('--force');
  const hasPersistedTranscript = fs.existsSync(transcriptPath());
  if (!force && (sessionTranscript.length > 0 || hasPersistedTranscript)) {
    const answer = await ask('Clear current session/context? Type CLEAR to confirm: ');
    if (answer.trim() !== 'CLEAR') {
      console.log(systemLine('Session/context unchanged.', 'yellow'));
      return;
    }
  }

  clearTranscript();
  deleteTranscriptFromDisk();
  writeTaskLog({ type: 'chat.transcript_cleared', source: 'slash_clear' });
  console.log(systemLine('Session/context cleared.', 'green'));
}

function handleCompactCommand() {
  if (sessionTranscript.length === 0) {
    loadTranscriptFromDisk();
  }

  if (sessionTranscript.length === 0) {
    console.log(systemLine('No current session/context to compact.', 'yellow'));
    return;
  }

  const compacted = [
    `Compacted ${sessionTranscript.length} recent exchange${sessionTranscript.length === 1 ? '' : 's'}:`,
    '',
    ...sessionTranscript.map((entry, index) => [
      `${index + 1}. User: ${truncateText(entry.prompt, 180)}`,
      `   ${entry.headId.toUpperCase()}: ${truncateText(entry.response, 220)}`,
    ].join('\n')),
  ].join('\n');

  sessionTranscript.length = 0;
  sessionTranscript.push({
    headId: 'hydra',
    prompt: 'Session compacted',
    response: compacted,
    at: Date.now(),
  });
  saveTranscriptToDisk();
  writeTaskLog({ type: 'chat.transcript_compacted' });
  console.log(systemLine('Session/context compacted.', 'green'));
}

function handleForkCommand(argsForFork = []) {
  if (sessionTranscript.length === 0) {
    loadTranscriptFromDisk();
  }

  if (sessionTranscript.length === 0) {
    console.log(systemLine('No current session/context to fork.', 'yellow'));
    return;
  }

  const name = argsForFork[0] || `fork-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const file = saveTranscriptToDisk(sessionFilePath(name));
  if (!file) {
    console.log(systemLine('Failed to save session fork.', 'yellow'));
    return;
  }
  writeTaskLog({ type: 'chat.transcript_forked', name: safeSessionName(name), file });
  console.log(systemLine(`Session fork saved as ${safeSessionName(name)}.`, 'green'));
}

async function handleSideCommand(argsForSide = [], ask = askFromProcess) {
  const prompt = parsePrompt(argsForSide);
  if (!prompt) {
    printPromptUsage(BUILTIN_COMMANDS.side);
    return;
  }

  const head = selectSideHead();
  if (!head) {
    console.log(systemLine('No available head for /side.', 'yellow'));
    console.log('Run /heads to see available heads or /setup to connect one.');
    return;
  }

  await routePrompt({
    prompt,
    requestedHeads: [head.id],
    mode: 'side',
    ask,
    recordHistory: false,
  });
}

function selectSideHead() {
  const config = readProjectConfig();
  const heads = listHeads();
  if (config.mode?.type === 'solo' && config.mode.head) {
    const solo = heads.find((head) => head.id === config.mode.head);
    if (solo) return solo;
  }
  const workflow = normalizeWorkflow(config.workflow);
  if (workflow.enabled) {
    const chatHead = heads.find((head) => head.id === workflow.chat_head);
    if (chatHead) return chatHead;
  }
  return firstCallableHead(heads, ['gemini', 'codex', 'claude']) || heads[0] || null;
}

function sessionFilePath(name) {
  return path.join(process.cwd(), HYDRA_STATE_DIR, 'sessions', `${safeSessionName(name)}.json`);
}

function safeSessionName(name) {
  const cleaned = String(name || 'session')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'session';
}

async function handleMemoryCommand(argsForMemory, ask) {
  if (argsForMemory.length === 0) {
    const hydraFile = readHydraFile();
    if (!hydraFile.validation.valid) {
      console.log(systemLine(`.hydra validation failed: ${hydraFile.validation.errors.join(' ')}`, 'yellow'));
      return;
    }

    const memoryEntries = activeMemoryEntries(hydraFile.sections.MEMORY);
    if (memoryEntries.length === 0) {
      console.log(systemLine('No memory entries found.'));
      return;
    }

    for (const entry of memoryEntries) {
      console.log(`- ${entry.timestamp} | ${entry.author} | ${entry.content}`);
    }
    return;
  }

  if (argsForMemory[0] === 'add') {
    const note = argsForMemory.slice(1).join(' ');
    if (!note) {
      console.log(systemLine('Missing note. Use /hydra memory add "note".', 'yellow'));
      return;
    }

    await append_entry('MEMORY', 'USER', note);
    writeTaskLog({
      type: 'memory.added',
      note,
    });
    console.log(systemLine('Memory entry appended to .hydra.', 'green'));
    return;
  }

  if (argsForMemory[0] === 'clear') {
    if (!argsForMemory.includes('--force')) {
      console.log(systemLine('Clearing all memory requires --force and explicit confirmation.', 'yellow'));
      console.log('/hydra memory clear --force');
      return;
    }

    const answer = await ask('Clear all memory? [Y/N]: ');
    if (answer.trim().toLowerCase() !== 'y') {
      console.log(systemLine('Memory unchanged.', 'yellow'));
      return;
    }

    await append_entry('MEMORY', 'USER', 'MEMORY CLEARED -- prior memory entries ignored from this point forward.');
    writeTaskLog({
      type: 'memory.cleared',
      mode: 'logical_append_only',
    });
    console.log(systemLine('Memory cleared. Previous entries remain in .hydra history but are ignored.', 'green'));
    return;
  }

  console.log(systemLine('Usage: /hydra memory | /hydra memory add "note" | /hydra memory clear --force', 'yellow'));
}

async function handleBudgetCommand(argsForBudget, ask) {
  const action = argsForBudget[0];
  if (!action || action === 'status') {
    console.log(formatBudgetDisplay());
    return;
  }

  if (action.toUpperCase() === 'OFF') {
    await disableBudget();
    await resumeAllHeads();
    console.log(systemLine('Budget tracking set to OFF.', 'green'));
    return;
  }

  if (action.toUpperCase().startsWith('ON--')) {
    const amount = parseBudgetAmount(action);
    if (amount === null) {
      console.log(systemLine('Missing budget amount. Use /hydra budget ON--$5.00', 'yellow'));
      return;
    }

    await enableBudget(amount);
    await resumeAllHeads();
    console.log(systemLine(`Budget tracking set to ON $${amount.toFixed(2)}.`, 'green'));
    return;
  }

  if (action === 'add') {
    const amount = parseBudgetAmount(argsForBudget[1]);
    if (amount === null) {
      console.log(systemLine('Missing amount. Use /hydra budget add --$2.00', 'yellow'));
      return;
    }

    const total = await addBudget(amount);
    await resumeAllHeads();
    console.log(systemLine(`Budget increased to ${formatUsd(total)}.`, 'green'));
    return;
  }

  if (action === 'set') {
    const amount = parseBudgetAmount(argsForBudget[1]);
    if (amount === null) {
      console.log(systemLine('Missing amount. Use /hydra budget set --$10.00', 'yellow'));
      return;
    }

    await setBudgetLimit(amount);
    await resumeAllHeads();
    console.log(systemLine(`Budget set to ${formatUsd(amount)}.`, 'green'));
    return;
  }

  if (action === 'reset') {
    await resetBudget();
    await resumeAllHeads();
    console.log(systemLine('Budget usage reset.', 'green'));
    return;
  }

  if (action === 'alert') {
    const percent = Number(argsForBudget[1]);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      console.log(systemLine('Missing alert percent. Use /hydra budget alert 80', 'yellow'));
      return;
    }

    await setBudgetAlert(percent);
    console.log(systemLine(`Budget alert threshold set to ${percent}%.`, 'green'));
    return;
  }

  if (action === 'extend') {
    await promptExtendBudget(ask);
    return;
  }

  console.log(systemLine('Usage: /hydra budget | ON--$5.00 | OFF | status | add --$2.00 | set --$10.00 | reset | alert 80', 'yellow'));
}

async function handleDecideCommand(argsForDecide, ask) {
  const command = argsForDecide[0];
  if (command === 'history') {
    const history = getDecisionHistory(readHydraFile());
    if (history.length === 0) {
      console.log('[HYDRA] No decisions logged.');
      return;
    }

    for (const entry of history) {
      console.log(`${entry.timestamp} | ${entry.author} | ${entry.content}`);
    }
    return;
  }

  if (command === 'revisit') {
    const decisionId = argsForDecide[1];
    if (!decisionId) {
      console.log(systemLine('Usage: /hydra decide revisit dec_001', 'yellow'));
      return;
    }

    const revisited = loadDecisionFromTasks(decisionId);
    if (!revisited) {
      console.log(systemLine(`No saved responses found for ${decisionId}.`, 'yellow'));
      return;
    }

    clearPendingDecision();
    const originalChoice = originalChoiceForDecision(decisionId);
    const decisionResult = await showDecisionPrompt(revisited.responses, revisited.prompt, ask, {
      adapters: createDecisionAdaptersForCurrentHeads(revisited.responses),
      decision: revisited,
    });
    applyDecisionResult(decisionResult);
    if (decisionResult?.head || ['split', 'merged'].includes(decisionResult?.action)) {
      await logDecisionRevisit(decisionId, originalChoice, decisionResult.head || decisionResult.action);
    }
    return;
  }

  const pending = getPendingDecision();
  if (pending) {
    const decisionResult = await showDecisionPrompt(pending.responses, pending.prompt, ask, {
      adapters: createDecisionAdaptersForCurrentHeads(pending.responses),
      decision: pending,
    });
    applyDecisionResult(decisionResult);
    return;
  }

  const last = getLastParallelDecision();
  if (last) {
    const decision = createPendingDecision(last.prompt, last.responses);
    const decisionResult = await showDecisionPrompt(last.responses, last.prompt, ask, {
      adapters: createDecisionAdaptersForCurrentHeads(last.responses),
      decision,
    });
    applyDecisionResult(decisionResult);
    return;
  }

  console.log('[HYDRA] No pending decision. Run a parallel prompt first.');
  console.log('/hydra all [prompt]');
}

function originalChoiceForDecision(decisionId) {
  const entry = getDecisionHistory(readHydraFile()).find((decision) => decision.author === decisionId);
  const match = entry?.content.match(/chose:\s*([^|]+)/i);
  return match ? match[1].trim() : '';
}

async function handlePermissionsAllCommand(argsForPermissionsAll, ask) {
  await confirmFullPermissions({
    save: argsForPermissionsAll.includes('--save'),
    ask,
  });
}

async function handlePermissionsCommand(argsForPermissions, ask) {
  const command = argsForPermissions[0];
  if (!command) {
    console.log(formatPermissionsStatus());
    return;
  }

  if (command === 'reset') {
    await resetPermissions();
    console.log('🟢 Permissions reset to default for all future sessions');
    return;
  }

  const level = permissionLevelFromInput(command);
  if (level === null) {
    console.log(systemLine('Usage: /hydra permissions strict | default | trust | full | reset | 0 | 1 | 2 | 3', 'yellow'));
    return;
  }

  if (level === 3) {
    await confirmFullPermissions({
      save: argsForPermissions.includes('--save'),
      ask,
    });
    return;
  }

  const state = await setPermissionLevel(level);
  console.log(`🟢 Permissions set to ${state.definition.label}`);
}

function handleAllowCommand(argsForAllow) {
  const grant = argsForAllow[0];
  if (grant === 'writes') {
    const duration = argsForAllow[1];
    if (duration === 'this-session') {
      allowWritesThisSession();
      console.log('🟢 File writes allowed for this session');
      return;
    }

    const minutesMatch = String(duration || '').match(/^(\d+)m$/);
    if (minutesMatch) {
      const minutes = Number(minutesMatch[1]);
      allowWritesFor(minutes);
      console.log(`🟢 File writes allowed for ${minutes} minutes`);
      return;
    }
  }

  if (grant === 'path') {
    const targetPath = argsForAllow[1];
    if (targetPath) {
      const granted = allowPath(targetPath);
      if (!granted) {
        console.log(systemLine('Path grants must stay within project scope.', 'yellow'));
        return;
      }
      console.log(`🟢 Full access granted within ${targetPath}`);
      return;
    }
  }

  if (grant === 'command') {
    const command = argsForAllow.slice(1).join(' ');
    if (command) {
      allowCommandOnce(command);
      console.log(`🟢 Command allowed once: ${command}`);
      return;
    }
  }

  console.log(systemLine('Usage: /hydra allow writes 10m | writes this-session | path ./src | command "npm test"', 'yellow'));
}

function handleDenyCommand(argsForDeny) {
  if (argsForDeny[0] === 'shell') {
    denyShellExecution();
    console.log('🟢 Shell execution blocked');
    return;
  }

  console.log(systemLine('Usage: /hydra deny shell', 'yellow'));
}

async function confirmFullPermissions({ save, ask }) {
  const current = getPermissionState();
  console.log(fullPermissionsPrompt());

  const activate = await ask('Activate full permissions? [Y/N]: ');
  if (activate.trim().toLowerCase() !== 'y') {
    console.log(`Permissions unchanged. Still at ${current.definition.label}.`);
    return;
  }

  if (save) {
    console.log(permanentFullPermissionsPrompt());
    const persist = await ask('Are you sure? [Y/N]: ');
    if (persist.trim().toLowerCase() === 'y') {
      await setPermissionLevel(3, { save: true });
      console.log('🟢 [HYDRA] Full permissions active for this session.');
      console.log('🟢 [HYDRA] Full permissions saved permanently.');
      return;
    }
  }

  await setPermissionLevel(3);
  console.log('🟢 [HYDRA] Full permissions active for this session.');
}


function parseWithHeads(rawArgs) {
  const withIndex = rawArgs.indexOf('--with');
  if (withIndex === -1) {
    return ['all'];
  }

  const value = rawArgs[withIndex + 1];
  if (!value) {
    throw new Error('Missing value for --with.');
  }

  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function parsePrompt(rawArgs) {
  const promptIndex = rawArgs.indexOf('--prompt');
  if (promptIndex !== -1) {
    return rawArgs.slice(promptIndex + 1).join(' ');
  }

  const promptParts = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    if (rawArgs[index] === '--with') {
      index += 1;
      continue;
    }

    promptParts.push(rawArgs[index]);
  }

  return promptParts.join(' ');
}

function parseHeadPromptArgs(rawArgs, headId) {
  const promptParts = [];
  const withHeads = [];
  let role = null;
  let model = null;
  let parsingOptions = true;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === '--with') {
      const heads = rawArgs[index + 1];
      if (!heads) {
        throw new Error('Missing value for --with.');
      }

      withHeads.push(...heads.split(',').map((part) => part.trim()).filter(Boolean));
      index += 1;
      continue;
    }

    if (value === '--prompt') {
      promptParts.push(...rawArgs.slice(index + 1));
      break;
    }

    if (parsingOptions) {
      const resolvedRole = !role ? resolveHeadRole(value) : null;
      if (resolvedRole) {
        role = resolvedRole;
        continue;
      }

      const resolvedModel = !model ? resolveHeadModel(headId, value) : null;
      if (resolvedModel) {
        model = resolvedModel;
        continue;
      }
    }

    parsingOptions = false;
    promptParts.push(value);
  }

  return {
    prompt: promptParts.join(' '),
    withHeads,
    role,
    model,
  };
}

function parseUsefulHeadPromptArgs(rawArgs, headId) {
  const promptParts = [];
  const withHeads = [];
  let model = null;
  let parsingOptions = true;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === '--with') {
      const heads = rawArgs[index + 1];
      if (!heads) {
        throw new Error('Missing value for --with.');
      }

      withHeads.push(...heads.split(',').map((part) => part.trim()).filter(Boolean));
      index += 1;
      continue;
    }

    if (value === '--prompt') {
      promptParts.push(...rawArgs.slice(index + 1));
      break;
    }

    if (parsingOptions) {
      const resolvedModel = !model ? resolveHeadModel(headId, value) : null;
      if (resolvedModel) {
        model = resolvedModel;
        continue;
      }
    }

    parsingOptions = false;
    promptParts.push(value);
  }

  return {
    prompt: promptParts.join(' '),
    withHeads,
    model,
  };
}

function resolveWithContextEntries(withHeads) {
  if (!withHeads.length) {
    return [];
  }

  const entries = [];
  for (const head of resolveHeads(withHeads)) {
    const lastResponse = lastHeadResponses.get(head.id);
    if (!lastResponse?.content?.trim()) {
      console.log(systemLine(`No previous ${head.name} response is available to inject this session.`, 'yellow'));
      continue;
    }

    entries.push({
      head: head.id,
      tag: head.tag,
      name: head.name,
      prompt: lastResponse.prompt,
      content: lastResponse.content,
      timestamp: lastResponse.timestamp,
    });
  }

  return entries;
}

function rememberHeadResponse({ head, prompt, content }) {
  if (!content.trim()) {
    return;
  }

  lastHeadResponses.set(head, {
    head,
    prompt,
    content,
    timestamp: new Date().toISOString(),
  });
}

function formatWithContextBlock(entries) {
  if (!entries.length) {
    return '';
  }

  const sections = entries.map((entry) => `${entry.tag} LAST FULL RESPONSE
Prompt: ${entry.prompt}
Response:
${entry.content}`);

  return `WITH CONTEXT [injected automatically by Hydra]

The user asked this head to use prior output from: ${entries.map((entry) => entry.name).join(', ')}.
Heads do not communicate directly. Hydra is injecting this context.

${sections.join('\n\n')}`;
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = '';
  let quote = null;

  for (const char of command) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

async function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(false), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function askFromProcess(question) {
  if (!input.isTTY) {
    if (!pipedAnswers) {
      const text = fs.readFileSync(0, 'utf8');
      pipedAnswers = text.split(/\r?\n/);
      if (pipedAnswers.at(-1) === '') {
        pipedAnswers.pop();
      }
    }

    output.write(question);
    return pipedAnswers.shift() || '';
  }

  return getOrCreateQuestionInterface().question(question);
}

async function enforceBudgetBeforePrompt({ heads, ask }) {
  const { config, usage } = getBudgetState();
  let allowedHeads = heads.filter((head) => !shouldPauseHead(head.id));

  for (const paused of heads.filter((head) => shouldPauseHead(head.id))) {
    console.log(`${paused.tag.padEnd(10)} Paused       budget limit reached`);
  }

  if (!config.enabled || !config.limit_usd || usage.total < config.limit_usd) {
    return { heads: allowedHeads, endSession: false };
  }

  await pauseMeteredHeads(allowedHeads.filter((head) => head.metered).map((head) => head.id));
  console.log(formatBudgetLimitReached());
  const choice = (await ask('Choice: ')).trim().toLowerCase();

  if (choice === 'x') {
    await promptExtendBudget(ask);
    await resumeAllHeads();
    return { heads, endSession: false };
  }

  if (choice === 'o') {
    await disableBudget();
    await resumeAllHeads();
    return { heads, endSession: false };
  }

  if (choice === 'e') {
    return { heads: [], endSession: true };
  }

  allowedHeads = heads.filter((head) => !shouldPauseHead(head.id));
  return { heads: allowedHeads, endSession: false };
}

async function handleBudgetThresholdIfNeeded({ ask }) {
  const threshold = budgetThreshold();
  if (threshold.state === 'ok' || threshold.state === 'off') {
    return { endSession: false };
  }

  if (threshold.state === 'alert') {
    console.log(formatBudgetAlert());
    const choice = (await ask('Choice: ')).trim().toLowerCase();
    if (choice === 'c') {
      await setBudgetAlert(90);
      return { endSession: false };
    }
    if (choice === 'x') {
      await promptExtendBudget(ask);
      return { endSession: false };
    }
    if (choice === 'p') {
      await pauseMeteredHeads(getMeteredHeadIds());
      return { endSession: false };
    }
    if (choice === 'o') {
      await disableBudget();
      await resumeAllHeads();
    }
    return { endSession: false };
  }

  await pauseMeteredHeads(getMeteredHeadIds());
  console.log(formatBudgetLimitReached());
  const choice = (await ask('Choice: ')).trim().toLowerCase();
  if (choice === 'x') {
    await promptExtendBudget(ask);
    await resumeAllHeads();
  } else if (choice === 'o') {
    await disableBudget();
    await resumeAllHeads();
  } else if (choice === 'e') {
    return { endSession: true };
  }

  return { endSession: false };
}

async function promptExtendBudget(ask) {
  console.log(formatExtendBudgetPrompt());
  const answer = await ask('New total limit: $ ');
  const amount = parseBudgetAmount(answer);
  if (amount === null) {
    console.log(systemLine('Budget unchanged. Invalid amount.', 'yellow'));
    return;
  }

  await setBudgetLimit(amount);
  console.log(systemLine(`Budget extended to ${formatUsd(amount)}.`, 'green'));
}

function getMeteredHeadIds() {
  return detectConnectedHeads()
    .filter((head) => head.metered)
    .map((head) => head.id);
}

main()
  .catch((error) => {
    console.error(systemLine(error.message, 'red'));
    process.exitCode = 1;
  })
  .finally(() => {
    closeProcessQuestionInterface();
  });
