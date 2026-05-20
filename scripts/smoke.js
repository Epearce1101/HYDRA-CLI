import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addBudget,
  budgetThreshold,
  disableBudget,
  enableBudget,
  pauseMeteredHeads,
  recordBudgetUsage,
  resetBudget,
  resumeAllHeads,
  setBudgetAlert,
  setBudgetLimit,
  shouldPauseHead,
} from '../src/budget.js';
import { append_entry, readHydraFile } from '../src/hydra-file.js';
import { getRecentResponses, markEnd, markStart, resetActivity } from '../src/head-activity.js';
import {
  BUILTIN_COMMANDS,
  ROLE_COMMANDS,
  getNicknameEntries,
  isReservedCommandName,
  resolveCommandName,
} from '../src/command-registry.js';
import { hydraCompleter, completionCandidates, isCompleteCommand } from '../src/completion.js';
import { activeMemoryEntries, buildSystemContext } from '../src/context-builder.js';
import { responsesAreDifferent, scoreDifference } from '../src/decision.js';
import {
  dashboardContentWidth,
  formatDashboardResponseLabel,
  formatDashboardResponseLines,
  pinDashboardBlockToBottom,
  promptInputCursorColumn,
  renderPromptBlock,
} from '../src/dashboard.js';
import { COLOR_PALETTE, addHeadToRegistry, listHeads, refreshHeadsRegistry, removeHeadFromRegistry } from '../src/heads.js';
import { bestLogoMode, bestTitleMode, centerBlock, centerLine } from '../src/logo.js';
import { formatModelShortName } from '../src/model-display.js';
import { formatNativeCommandHelp, resolveNativeProvider } from '../src/native-commands.js';
import { getToolDefinitions } from '../src/tools.js';
import {
  formatHeadDisplayName,
  formatHeadDisplayTag,
  formatPromptHeadIndicator,
  isRepurposedBuiltinHead,
  visibleTextLength,
} from '../src/head-display.js';
import {
  allowCommandOnce,
  allowPath,
  evaluateCommandExecution,
  evaluateFileRead,
  evaluateFileWrite,
  isDestructiveShellCommand,
  resetPermissions,
  setPermissionLevel,
} from '../src/permissions.js';
import { ensureProjectState, readProjectConfig, writeProjectConfig } from '../src/project.js';
import { formatProviderCommandHelp, formatRoleContext, resolveHeadModel, resolveHeadRole } from '../src/provider-commands.js';
import * as judgeModule from '../src/orchestration.js';
import * as artifactsModule from '../src/artifacts.js';
import * as intakeModule from '../src/intake.js';
import * as gatesModule from '../src/gates.js';
import * as implementationModule from '../src/implementation.js';
import * as setupModule from '../src/setup-wizard.js';
import {
  validateArchitectureContract,
  validateDecisionLog,
  validateGateSummary,
  validateImplementationNotes,
  validateOwnershipMap,
  validateTaskBrief,
  isValidSharedFileRule,
  newMetadata,
} from '../src/artifact-schemas.js';
import {
  detectSubscriptionBinary,
  resetSubscriptionBinaryCache,
  SubscriptionAdapter,
} from '../src/adapters/subscription-base.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-smoke-'));

try {
  await runSmoke(root);
  console.log('[HYDRA] Smoke checks passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

async function runSmoke(rootDir) {
  ensureProjectState(rootDir);

  await testHydraFile(rootDir);
  testProjectConfigRoundTrip(rootDir);
  await testContextBuilder(rootDir);
  testDecisionScoring();
  await testBudget(rootDir);
  await testPermissions(rootDir);
  testCommandRegistry();
  testModelDisplay();
  testHeadDisplay();
  testPromptHeadIndicatorGrid();
  testHeadPaletteCycles(rootDir);
  testHeadRemovalAllowsBuiltins(rootDir);
  testDashboardResponseLabels();
  testDashboardPromptPinning();
  testDashboardPromptBlock();
  testDashboardResponseWrapping();
  testProviderCommands();
  testNativeCommands();
  testHeadActivityResponses();
  testResponsiveLogo();
  testCompletion();
  testJudgeParser();
  testArtifactsTaskId();
  testArtifactSchemas();
  testArtifactWriters(rootDir);
  testIntakeParser();
  testIntakeHeuristics();
  testSetupRoleChoices();
  await testSetupHeadCapPrompt();
  testArchitectParser();
  testArchitectureSchemaAndWriter(rootDir);
  testOwnershipSchemaAndHelpers();
  testOwnershipWriter(rootDir);
  testImplementationNotesParser();
  testImplementationNotesSchemaAndWriter(rootDir);
  await testSubscriptionAdapter(rootDir);
}

function testHeadRemovalAllowsBuiltins(rootDir) {
  refreshHeadsRegistry();
  const initial = listHeads(rootDir);
  assert.ok(initial.some((head) => head.id === 'claude' && head.builtin));
  assert.equal(removeHeadFromRegistry('claude', rootDir), true);
  assert.equal(listHeads(rootDir).some((head) => head.id === 'claude'), false);
  for (const head of [...listHeads(rootDir)]) {
    assert.equal(removeHeadFromRegistry(head.id, rootDir), true);
  }
  assert.deepEqual(listHeads(rootDir), []);
  refreshHeadsRegistry();
}

function testOwnershipSchemaAndHelpers() {
  const { parseOwnershipSuggestions, buildDefaultOwnershipMap, validatePathsAgainstMap, pathMatchesAny, formatOwnershipMapForWorker } = gatesModule;

  assert.equal(isValidSharedFileRule('oracle_only_merge'), true);
  assert.equal(isValidSharedFileRule('single_delegate:codex'), true);
  assert.equal(isValidSharedFileRule('timeboxed_window:integration_check'), true);
  assert.equal(isValidSharedFileRule('whatever'), false);
  assert.equal(isValidSharedFileRule('single_delegate:'), false);

  const goodMap = {
    ...newMetadata({ taskId: 'HYD-20260519-200000', artifact: 'ownership_map', ownerRole: 'oracle' }),
    artifact: 'ownership_map',
    status: 'ready',
    tracks: [
      { track_id: 'track-api', owner_role: 'code', owner_head: null, paths: ['src/api/**'], shared_allowed: false, dependencies: [] },
    ],
    shared_files: [
      { path: 'src/config.js', rule: 'oracle_only_merge', allowed_changes: ['add config key only'], expires_phase: 'integration_check' },
    ],
    cross_cutting_changes: [],
  };
  assert.equal(validateOwnershipMap(goodMap).ok, true);

  const badMap = validateOwnershipMap({
    ...goodMap,
    tracks: [
      { track_id: 'track-api', owner_role: 'code', paths: ['**'], dependencies: [] },
      { track_id: 'track-api', owner_role: 'code', paths: ['src/api/**'], dependencies: [] },
    ],
    shared_files: [{ path: 'src/x.js', rule: 'banana', allowed_changes: [] }],
    cross_cutting_changes: 'not-an-array',
  });
  assert.equal(badMap.ok, false);
  assert.ok(badMap.errors.some((error) => error.includes('unlimited glob')));
  assert.ok(badMap.errors.some((error) => error.includes('duplicate "track-api"')));
  assert.ok(badMap.errors.some((error) => error.includes('shared_files[0].rule')));
  assert.ok(badMap.errors.some((error) => error.includes('cross_cutting_changes')));

  const parsedSuggestions = parseOwnershipSuggestions([
    'track-api: code: src/api/**',
    'track-ui|code|src/ui/**, src/components/**',
    'shared_file: src/config.js: oracle_only_merge: add config key only',
    'cross-cutting: bump shared schema version',
    'src/utils/format.js',
  ], { defaultRole: 'code' });
  assert.equal(parsedSuggestions.tracks.length, 3);
  assert.equal(parsedSuggestions.tracks[0].track_id, 'track-api');
  assert.equal(parsedSuggestions.tracks[1].paths.length, 2);
  assert.equal(parsedSuggestions.shared_files[0].rule, 'oracle_only_merge');
  assert.equal(parsedSuggestions.cross_cutting_changes[0], 'bump shared schema version');

  const defaultMap = buildDefaultOwnershipMap({ defaultRole: 'code', components: ['src/api/rate-limit.js', 'src/api'] });
  assert.equal(defaultMap.tracks.length, 1);
  assert.ok(defaultMap.tracks[0].paths.length >= 1);

  assert.equal(pathMatchesAny('src/api/rate-limit.js', ['src/api/**']), true);
  assert.equal(pathMatchesAny('src/ui/button.js', ['src/api/**']), false);
  assert.equal(pathMatchesAny('src/api/sub/dir/file.js', ['src/api/**']), true);

  const liveMap = {
    tracks: [
      { track_id: 'track-api', owner_role: 'code', paths: ['src/api/**'] },
      { track_id: 'track-ui', owner_role: 'code', paths: ['src/ui/**'] },
    ],
    shared_files: [
      { path: 'src/config.js', rule: 'oracle_only_merge', allowed_changes: [] },
      { path: 'docs/CHANGELOG.md', rule: 'append_only', allowed_changes: [] },
      { path: 'src/README.md', rule: 'read_only', allowed_changes: [] },
    ],
    cross_cutting_changes: [],
  };
  const result = validatePathsAgainstMap([
    'src/api/rate-limit.js',
    'src/ui/button.js',
    'src/config.js',
    'src/README.md',
    'src/other/thing.js',
  ], liveMap);
  assert.equal(result.ok, false);
  const unowned = result.violations.find((v) => v.kind === 'unowned' && v.path === 'src/other/thing.js');
  assert.ok(unowned, 'should flag src/other/thing.js as unowned');
  const readOnly = result.violations.find((v) => v.kind === 'shared_read_only_violation' && v.path === 'src/README.md');
  assert.ok(readOnly, 'should flag src/README.md read_only write');
  assert.equal(result.owned.length, 3);

  const readOnlyOk = validatePathsAgainstMap(['src/README.md'], liveMap, { writes: false });
  assert.equal(readOnlyOk.ok, true);

  const formatted = formatOwnershipMapForWorker(liveMap, { headRole: 'code' });
  assert.ok(formatted.includes('OWNERSHIP MAP'));
  assert.ok(formatted.includes('YOUR TRACK'));
  assert.ok(formatted.includes('src/config.js [oracle_only_merge]'));
  assert.ok(formatted.includes('src/README.md [read_only]'));
}

function testOwnershipWriter(rootDir) {
  const { buildOwnershipMap, writeOwnershipMap, readArtifact, newTaskId } = artifactsModule;
  const taskId = newTaskId(new Date('2026-05-19T21:00:00Z'));
  const artifact = buildOwnershipMap({
    taskId,
    tracks: [
      { track_id: 'track-api', owner_role: 'code', owner_head: null, paths: ['src/api/**'], shared_allowed: false, dependencies: [] },
      { track_id: 'track-ui', owner_role: 'code', owner_head: null, paths: ['src/ui/**'], shared_allowed: false, dependencies: ['track-api'] },
    ],
    sharedFiles: [
      { path: 'src/config.js', rule: 'oracle_only_merge', allowed_changes: ['add config key only'], expires_phase: 'integration_check' },
    ],
    crossCuttingChanges: ['version bump'],
  });
  const writeResult = writeOwnershipMap(taskId, artifact, rootDir);
  assert.equal(writeResult.validation.ok, true, `ownership_map validation: ${writeResult.validation.errors.join('; ')}`);
  const json = JSON.parse(readArtifact(taskId, 'ownership_map.json', rootDir));
  assert.equal(json.tracks.length, 2);
  assert.equal(json.tracks[0].track_id, 'track-api');
  assert.equal(json.shared_files[0].rule, 'oracle_only_merge');
  assert.deepEqual(json.cross_cutting_changes, ['version bump']);
  assert.equal(json.inputs[0].artifact, 'task_brief');
  assert.equal(json.inputs[1].artifact, 'architecture_contract');
}

function testImplementationNotesParser() {
  const { parseImplementationNotes, buildImplementationNotesPromptSection } = implementationModule;

  const prompt = buildImplementationNotesPromptSection({
    roleTag: 'code',
    ownershipMap: {
      tracks: [
        { track_id: 'track-api', owner_role: 'code', paths: ['src/api/**'] },
      ],
    },
  });
  assert.ok(prompt.includes('IMPLEMENTATION NOTES REQUIRED'));
  assert.ok(prompt.includes('track-api'));

  const fenced = parseImplementationNotes(`Here is the implementation.
\`\`\`json
{
  "track_id": "track-api",
  "files_changed": [{"path": "src/api/rate-limit.js", "change": "modify", "reason": "add limiter"}],
  "summary": "Adds a limiter.",
  "assumptions": ["Redis exists"],
  "rollback_notes": "Remove the middleware import.",
  "verification_suggested": [{"command": "npm test", "expected": "passes"}]
}
\`\`\``);
  assert.equal(fenced.ok, true);
  assert.equal(fenced.track_id, 'track-api');
  assert.equal(fenced.files_changed[0].change, 'edit');

  const bare = parseImplementationNotes('{"track_id":"track-ui","files_changed":[{"path":"src/ui/button.js","change":"add","reason":"new button"}],"summary":"Adds UI.","assumptions":[],"rollback_notes":"Delete file.","verification_suggested":["npm test"]}');
  assert.equal(bare.ok, true);
  assert.equal(bare.verification_suggested[0].expected, 'command succeeds');

  const garbage = parseImplementationNotes('No structured notes here.');
  assert.equal(garbage.ok, false);
  assert.equal(garbage.reason, 'implementation_notes_unparseable');
}

function testImplementationNotesSchemaAndWriter(rootDir) {
  const { buildImplementationNotes, buildDecisionLog, buildOwnershipMap, writeImplementationNotes, readArtifact, newTaskId } = artifactsModule;
  const { validatePathsAgainstMap } = gatesModule;
  const taskId = newTaskId(new Date('2026-05-19T22:00:00Z'));
  const ownershipMap = buildOwnershipMap({
    taskId,
    tracks: [
      { track_id: 'track-api', owner_role: 'code', owner_head: null, paths: ['src/api/**'], shared_allowed: false, dependencies: [] },
    ],
    sharedFiles: [
      { path: 'src/config.js', rule: 'oracle_only_merge', allowed_changes: ['add RATE_LIMIT_*'], expires_phase: 'integration_check' },
    ],
    crossCuttingChanges: [],
  });

  const good = buildImplementationNotes({
    taskId,
    ownerHead: 'code-1',
    ownerRole: 'code',
    trackId: 'track-api',
    filesChanged: [
      { path: 'src/api/rate-limit.js', change: 'add', reason: 'new limiter middleware' },
      { path: 'src/config.js', change: 'edit', reason: 'add limit config' },
    ],
    summary: 'Adds a rate limiter in the API path.',
    assumptions: ['Config is loaded before middleware starts'],
    rollbackNotes: 'Remove the middleware and config key.',
    verificationSuggested: [{ command: 'npm test', expected: 'passes' }],
    ownershipValidation: validatePathsAgainstMap(['src/api/rate-limit.js', 'src/config.js'], ownershipMap),
  });
  assert.equal(validateImplementationNotes(good, { ownershipMap }).ok, true);
  const writeResult = writeImplementationNotes(taskId, good, rootDir, { ownershipMap });
  assert.equal(writeResult.validation.ok, true, `implementation_notes validation: ${writeResult.validation.errors.join('; ')}`);
  const md = readArtifact(taskId, 'implementation_notes_code-1.md', rootDir);
  assert.ok(md.includes('# Implementation Notes'));
  assert.ok(md.includes('src/api/rate-limit.js'));
  assert.ok(md.includes('## Ownership Validation'));

  const bad = validateImplementationNotes({
    ...good,
    track_id: '',
    files_changed: 'not-an-array',
    rollback_notes: '',
    verification_suggested: [],
  }, { ownershipMap });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((error) => error.includes('track_id')));
  assert.ok(bad.errors.some((error) => error.includes('files_changed')));
  assert.ok(bad.errors.some((error) => error.includes('rollback_notes')));
  assert.ok(bad.errors.some((error) => error.includes('verification_suggested')));

  const violation = validatePathsAgainstMap(['src/ui/button.js'], ownershipMap);
  assert.equal(violation.ok, false);
  const decision = buildDecisionLog({
    taskId,
    checkpoint: 'C',
    roleTag: 'code',
    prompt: 'Add rate limiting',
    responses: [
      {
        head: 'code-2',
        text: 'Touching the UI by mistake.',
        implementation_notes: { ok: true },
        implementation_notes_ref: 'implementation_notes_code-2@v1',
        ownership_violations: violation.violations,
      },
    ],
    judge: {
      action: 'pick',
      selected_option: 'A',
      confidence: 'medium',
      reasoning: 'Only option.',
      synthesized: null,
      user_question: null,
      risks: [],
    },
    userChoice: { action: 'accept' },
  });
  assert.equal(decision.options_evaluated[0].evidence_refs[0], 'implementation_notes_code-2@v1');
  assert.equal(decision.options_evaluated[0].ownership_violations[0].path, 'src/ui/button.js');
}

function testArchitectParser() {
  const { parseArchitectResponse, parseArchitectJudgeResponse, formatArchitectureContractForWorker } = gatesModule;

  const good = parseArchitectResponse(`Here it is:
\`\`\`json
{
  "components_changed": ["src/api/rate-limit.js"],
  "boundaries": ["middleware stays single-purpose"],
  "interfaces": { "unchanged": false, "new": ["X-RateLimit-* headers"], "changed": [] },
  "invariants": ["responses always include CORS headers"],
  "ownership_suggestions": ["track-api: code: src/api/**"],
  "failure_modes": ["redis unavailable"],
  "test_strategy": "Unit tests for limiter + integration test hitting /v1/health 200 times.",
  "security_ops_considerations": ["lockout on abuse"],
  "tradeoffs": { "chosen": "sliding window", "alternatives": ["token bucket"], "why_rejected": ["less smooth"] },
  "deferred_decisions": ["per-tenant overrides"],
  "notes": "Keeps middleware single-purpose; uses gateway for limits."
}
\`\`\``);
  assert.equal(good.ok, true);
  assert.deepEqual(good.components_changed, ['src/api/rate-limit.js']);
  assert.equal(good.interfaces.unchanged, false);
  assert.deepEqual(good.interfaces.new, ['X-RateLimit-* headers']);
  assert.equal(good.test_strategy.includes('Unit tests'), true);

  const garbage = parseArchitectResponse('I am not returning JSON, sorry.');
  assert.equal(garbage.ok, false);
  assert.ok(garbage.deferred_decisions.length >= 1);
  assert.equal(garbage.interfaces.unchanged, true);
  assert.ok(garbage.notes);

  const partialInterface = parseArchitectResponse('{"components_changed":["x"],"interfaces":{"new":[],"changed":[]},"test_strategy":"manual","tradeoffs":{}}');
  assert.equal(partialInterface.ok, true);
  // No new/changed and unchanged not set → normalized to unchanged=true
  assert.equal(partialInterface.interfaces.unchanged, true);

  const judgePicked = parseArchitectJudgeResponse('```json\n{"action":"pick","selected_option":"B","confidence":"high","reasoning":"Cleaner boundaries.","risks":[]}\n```');
  assert.equal(judgePicked.ok, true);
  assert.equal(judgePicked.action, 'pick');
  assert.equal(judgePicked.selected_option, 'B');

  const judgeGarbage = parseArchitectJudgeResponse('not json');
  assert.equal(judgeGarbage.ok, false);
  assert.equal(judgeGarbage.action, 'ask_user');

  const formatted = formatArchitectureContractForWorker(good);
  assert.ok(formatted.includes('ARCHITECTURE CONTRACT'));
  assert.ok(formatted.includes('Components'));
  assert.ok(formatted.includes('New interfaces'));
}

function testArchitectureSchemaAndWriter(rootDir) {
  const { buildArchitectureContract, writeArchitectureContract, readArtifact, newTaskId } = artifactsModule;
  const taskId = newTaskId(new Date('2026-05-19T20:00:00Z'));

  const goodContract = {
    ...newMetadata({ taskId, artifact: 'architecture_contract', ownerRole: 'architect' }),
    artifact: 'architecture_contract',
    status: 'ready',
    components_changed: ['src/api/rate-limit.js'],
    boundaries: ['middleware stays single-purpose'],
    interfaces: { unchanged: false, new: ['X-RateLimit-*'], changed: [] },
    invariants: ['CORS preserved'],
    ownership_suggestions: ['track-api: code: src/api/**'],
    failure_modes: ['redis down'],
    test_strategy: 'unit + integration',
    security_ops_considerations: [],
    tradeoffs: { chosen: 'sliding window', alternatives: [], why_rejected: [] },
    deferred_decisions: [],
  };
  assert.equal(validateArchitectureContract(goodContract).ok, true);
  const bad = validateArchitectureContract({ ...goodContract, components_changed: 'not-an-array', test_strategy: '', interfaces: 'oops' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((error) => error.includes('components_changed')));
  assert.ok(bad.errors.some((error) => error.includes('test_strategy')));
  assert.ok(bad.errors.some((error) => error.includes('interfaces')));

  const artifact = buildArchitectureContract({
    taskId,
    ownerHead: 'claude',
    componentsChanged: ['src/api/rate-limit.js'],
    boundaries: ['middleware single-purpose'],
    interfaces: { unchanged: false, new: ['X-RateLimit-*'], changed: [] },
    invariants: ['CORS preserved'],
    ownershipSuggestions: ['track-api: code: src/api/**'],
    failureModes: ['redis down'],
    testStrategy: 'unit + integration coverage',
    securityOpsConsiderations: [],
    tradeoffs: { chosen: 'sliding window', alternatives: ['token bucket'], why_rejected: ['less smooth under burst'] },
    deferredDecisions: ['per-tenant overrides'],
    notes: 'Minimal, gateway-side limiter.',
  });
  const writeResult = writeArchitectureContract(taskId, artifact, rootDir);
  assert.equal(writeResult.validation.ok, true, `architecture_contract validation: ${writeResult.validation.errors.join('; ')}`);
  const md = readArtifact(taskId, 'architecture_contract.md', rootDir);
  assert.ok(md.includes('# Architecture Contract'));
  assert.ok(md.includes('## Components / Modules Changed'));
  assert.ok(md.includes('- src/api/rate-limit.js'));
  assert.ok(md.includes('- New:'));
  assert.ok(md.includes('## Tradeoffs'));
  assert.ok(md.includes('Chosen: sliding window'));
  const json = JSON.parse(readArtifact(taskId, 'architecture_contract.json', rootDir));
  assert.equal(json.tradeoffs.chosen, 'sliding window');
  assert.equal(json.inputs[0].artifact, 'task_brief');
}

function testIntakeParser() {
  const { parseIntakeResponse } = intakeModule;

  const fenced = parseIntakeResponse(`Sure, here's the brief:
\`\`\`json
{
  "goal": "Add /v1 rate limiting",
  "non_goals": ["auth changes"],
  "acceptance_criteria": ["429 after 100 req/min"],
  "risk_level": "high",
  "approval_policy": "user_approval_for_risk",
  "constraints": ["no breaking client changes"],
  "assumptions": ["redis is available"],
  "repo_area": ["src/api"],
  "suggested_worker_role": "code",
  "needs_spec": false,
  "reasoning": "Customer-facing rate limits; medium-blast surface."
}
\`\`\``);
  assert.equal(fenced.ok, true);
  assert.equal(fenced.goal, 'Add /v1 rate limiting');
  assert.equal(fenced.risk_level, 'high');
  assert.equal(fenced.approval_policy, 'user_approval_for_risk');
  assert.deepEqual(fenced.acceptance_criteria, ['429 after 100 req/min']);
  assert.equal(fenced.suggested_worker_role, 'code');

  const garbage = parseIntakeResponse('I am not going to comply with the JSON format, sorry.');
  assert.equal(garbage.ok, false);
  assert.equal(garbage.risk_level, 'medium');
  assert.equal(garbage.approval_policy, 'recommend');
  assert.ok(garbage.reasoning);

  const invalidEnums = parseIntakeResponse('{"goal":"x","acceptance_criteria":["y"],"risk_level":"nuclear","approval_policy":"vibes","suggested_worker_role":"CODE"}');
  assert.equal(invalidEnums.ok, true);
  assert.equal(invalidEnums.risk_level, 'medium');
  assert.equal(invalidEnums.approval_policy, 'recommend');
  assert.equal(invalidEnums.suggested_worker_role, 'code');
}

function testIntakeHeuristics() {
  const { suggestWorkerRoleFromBrief, heuristicBriefFromPrompt } = intakeModule;
  const config = { orchestration: { worker_roles: ['code', 'debug', 'test', 'review', 'architect', 'research', 'verify'] } };

  assert.equal(suggestWorkerRoleFromBrief({ goal: 'Fix a stack trace in payments', acceptance_criteria: [] }, config), 'debug');
  assert.equal(suggestWorkerRoleFromBrief({ goal: 'Write unit tests for the date parser', acceptance_criteria: [] }, config), 'test');
  assert.equal(suggestWorkerRoleFromBrief({ goal: 'Design a new module boundary between auth and billing', acceptance_criteria: ['interface stays stable'] }, config), 'architect');
  assert.equal(suggestWorkerRoleFromBrief({ goal: 'Implement rate limiting', acceptance_criteria: [] }, config), 'code');
  assert.equal(suggestWorkerRoleFromBrief({ goal: 'Just chat about something', acceptance_criteria: [] }, config), 'code');

  const heur = heuristicBriefFromPrompt('Fix the data loss bug in the migration script.');
  assert.equal(heur.risk_level, 'high');
  assert.equal(heur.approval_policy, 'user_approval_for_risk');
  assert.ok(heur.goal.includes('Fix the data loss'));

  const trivial = heuristicBriefFromPrompt('Update the README typo.');
  assert.equal(trivial.risk_level, 'low');
  assert.equal(trivial.approval_policy, 'recommend');
}

function testSetupRoleChoices() {
  const choices = setupModule.setupRoleChoices();
  assert.equal(choices[0].key, null);
  assert.equal(choices.at(-1).key, 'custom');
  const roleKeys = choices.slice(1, -1).map((choice) => choice.key);
  const sorted = [...roleKeys].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(roleKeys, sorted);
  assert.ok(roleKeys.includes('advisor'));
  assert.ok(roleKeys.includes('oracle'));
  assert.ok(roleKeys.includes('verify'));
}

async function testSetupHeadCapPrompt() {
  setupModule.resetHeadCapOverrideForTests();
  let prompts = 0;
  const accepted = await setupModule.confirmHeadCapOverrideIfNeeded({
    currentCount: 5,
    cap: 5,
    ask: async (question) => {
      prompts += 1;
      assert.match(question, /for this session/);
      return 'y';
    },
  });
  assert.equal(accepted, true);
  const reused = await setupModule.confirmHeadCapOverrideIfNeeded({
    currentCount: 6,
    cap: 5,
    ask: async () => {
      throw new Error('head cap prompt should only run once after acceptance');
    },
  });
  assert.equal(reused, true);
  assert.equal(prompts, 1);

  setupModule.resetHeadCapOverrideForTests();
  const belowCap = await setupModule.confirmHeadCapOverrideIfNeeded({
    currentCount: 4,
    cap: 5,
    ask: async () => {
      throw new Error('head cap prompt should not run below cap');
    },
  });
  assert.equal(belowCap, true);

  const rejected = await setupModule.confirmHeadCapOverrideIfNeeded({
    currentCount: 5,
    cap: 5,
    ask: async () => 'n',
  });
  assert.equal(rejected, false);
  setupModule.resetHeadCapOverrideForTests();
}

function testArtifactSchemas() {
  const baseMeta = newMetadata({ taskId: 'HYD-20260519-180000', artifact: 'decision_log', ownerRole: 'judge' });

  const goodDecision = {
    ...baseMeta,
    artifact: 'decision_log',
    status: 'ready',
    checkpoint: 'C',
    confidence_level: 'high',
    options_evaluated: [{ name: 'A', summary: 'opt a' }],
    selected: 'A',
    requires_user_approval: false,
  };
  const okDecision = validateDecisionLog(goodDecision);
  assert.equal(okDecision.ok, true, `decision_log should validate: ${okDecision.errors.join('; ')}`);

  const badDecision = validateDecisionLog({ ...goodDecision, checkpoint: 'Z', confidence_level: 'banana', options_evaluated: [] });
  assert.equal(badDecision.ok, false);
  assert.ok(badDecision.errors.some((error) => error.includes('checkpoint')));
  assert.ok(badDecision.errors.some((error) => error.includes('confidence_level')));
  assert.ok(badDecision.errors.some((error) => error.includes('options_evaluated')));

  const goodGate = {
    ...newMetadata({ taskId: 'HYD-20260519-180000', artifact: 'gate_summary', ownerRole: 'oracle' }),
    artifact: 'gate_summary',
    status: 'pass',
    gate: 'judge_verify_checkpoint_c',
    updated_artifacts: ['decision_log@v1'],
    blockers: [],
    judge_checkpoint_required: false,
    backtracks_used_in_phase: 0,
  };
  assert.equal(validateGateSummary(goodGate).ok, true);
  const badGate = validateGateSummary({ ...goodGate, status: 'kinda-pass', backtracks_used_in_phase: -3 });
  assert.equal(badGate.ok, false);
  assert.ok(badGate.errors.some((error) => error.includes('status')));
  assert.ok(badGate.errors.some((error) => error.includes('backtracks_used_in_phase')));

  const goodBrief = {
    ...newMetadata({ taskId: 'HYD-20260519-180000', artifact: 'task_brief', ownerRole: 'oracle' }),
    artifact: 'task_brief',
    status: 'draft',
    goal: 'Add rate limiting to the public API.',
    non_goals: [],
    acceptance_criteria: ['429 returned after 100 req/min'],
    risk_level: 'medium',
    approval_policy: 'recommend',
  };
  assert.equal(validateTaskBrief(goodBrief).ok, true);
  const badBrief = validateTaskBrief({ ...goodBrief, goal: '', acceptance_criteria: [], risk_level: 'extreme', approval_policy: 'whatever' });
  assert.equal(badBrief.ok, false);
  assert.ok(badBrief.errors.some((error) => error.includes('goal')));
  assert.ok(badBrief.errors.some((error) => error.includes('acceptance_criteria')));
  assert.ok(badBrief.errors.some((error) => error.includes('risk_level')));
  assert.ok(badBrief.errors.some((error) => error.includes('approval_policy')));
}

function testArtifactWriters(rootDir) {
  const { buildDecisionLog, buildGateSummary, buildTaskBrief, writeDecisionLog, writeGateSummary, writeTaskBrief, readArtifact, readLineage, appendLineage, newTaskId } = artifactsModule;
  const taskId = newTaskId(new Date('2026-05-19T19:00:00Z'));

  const responses = [
    { head: 'codex', text: 'Implement with a token bucket in the auth middleware.' },
    { head: 'claude', text: 'Use a sliding window in the gateway; cleaner separation of concerns.' },
  ];
  const judge = {
    ok: true,
    action: 'pick',
    selected_option: 'B',
    confidence: 'high',
    reasoning: 'Sliding window in the gateway keeps the middleware single-purpose.',
    synthesized: null,
    user_question: null,
    risks: [],
  };

  const decision = buildDecisionLog({ taskId, checkpoint: 'C', roleTag: 'code', prompt: 'Add rate limiting', responses, judge, userChoice: { action: 'accept' } });
  const decisionWrite = writeDecisionLog(taskId, decision, rootDir);
  assert.equal(decisionWrite.validation.ok, true, `decision_log validation: ${decisionWrite.validation.errors.join('; ')}`);
  const decisionRead = readArtifact(taskId, 'decision_log.json', rootDir);
  assert.ok(decisionRead, 'decision_log.json should be readable');
  const parsedDecision = JSON.parse(decisionRead);
  assert.equal(parsedDecision.selected, 'B');
  assert.equal(parsedDecision.confidence_level, 'high');

  const gate = buildGateSummary({
    taskId,
    gate: 'judge_verify_checkpoint_c',
    status: 'pass',
    updatedArtifacts: ['decision_log@v1'],
    nextGate: 'user_result',
    notes: 'smoke test',
  });
  const gateWrite = writeGateSummary(taskId, gate, rootDir);
  assert.equal(gateWrite.validation.ok, true, `gate_summary validation: ${gateWrite.validation.errors.join('; ')}`);
  const gateYaml = readArtifact(taskId, 'gate_judge_verify_checkpoint_c.yaml', rootDir);
  assert.ok(gateYaml.includes('gate: judge_verify_checkpoint_c'));
  assert.ok(gateYaml.includes('status: pass'));

  const brief = buildTaskBrief({
    taskId,
    goal: 'Add rate limiting to /v1 endpoints.',
    nonGoals: ['Auth changes'],
    acceptanceCriteria: ['429 after 100 req/min'],
    riskLevel: 'medium',
    approvalPolicy: 'recommend',
  });
  const briefWrite = writeTaskBrief(taskId, brief, rootDir);
  assert.equal(briefWrite.validation.ok, true, `task_brief validation: ${briefWrite.validation.errors.join('; ')}`);
  const briefMd = readArtifact(taskId, 'task_brief.md', rootDir);
  assert.ok(briefMd.includes('# Task Brief'));
  assert.ok(briefMd.includes('## Acceptance Criteria'));
  assert.ok(briefMd.includes('429 after 100 req/min'));

  appendLineage(taskId, { event: 'smoke_event', detail: 'test' }, rootDir);
  const lineage = readLineage(taskId, rootDir);
  assert.ok(lineage.length >= 1);
  assert.ok(lineage.some((event) => event.event === 'smoke_event'));
}

function testJudgeParser() {
  const { parseJudgeResponse } = judgeModule;

  const fenced = parseJudgeResponse(`Some prose...
\`\`\`json
{"action":"pick","selected_option":"B","confidence":"high","reasoning":"Option B is more concise.","synthesized":null,"user_question":null,"risks":[]}
\`\`\`
trailing chatter`);
  assert.equal(fenced.ok, true);
  assert.equal(fenced.action, 'pick');
  assert.equal(fenced.selected_option, 'B');
  assert.equal(fenced.confidence, 'high');

  const bareJson = parseJudgeResponse('{"action":"synthesize","confidence":"medium","reasoning":"merge both","synthesized":"unified answer","selected_option":null,"risks":["timing"]}');
  assert.equal(bareJson.ok, true);
  assert.equal(bareJson.action, 'synthesize');
  assert.equal(bareJson.synthesized, 'unified answer');
  assert.deepEqual(bareJson.risks, ['timing']);

  const garbage = parseJudgeResponse('I think option A is better, no JSON here.');
  assert.equal(garbage.ok, false);
  assert.equal(garbage.action, 'ask_user');
  assert.ok(garbage.user_question);

  const unknownAction = parseJudgeResponse('{"action":"banana","confidence":"yolo"}');
  assert.equal(unknownAction.action, 'ask_user');
  assert.equal(unknownAction.confidence, 'low');
}

function testArtifactsTaskId() {
  const { newTaskId } = artifactsModule;
  const fixed = newTaskId(new Date('2026-05-19T18:35:42Z'));
  assert.match(fixed, /^HYD-\d{8}-\d{6}$/);
  const a = newTaskId(new Date('2026-01-02T03:04:05'));
  assert.match(a, /^HYD-20260102-030405$/);
}

function testProjectConfigRoundTrip(rootDir) {
  const config = readProjectConfig(rootDir);
  config.auth['openrouter-head'] = 'api-key';
  config.models['openrouter-head'] = 'nvidia/nemotron-trinity-plus';
  config.roles['openrouter-head'] = 'code';
  writeProjectConfig(config, rootDir);

  const saved = readProjectConfig(rootDir);
  assert.equal(saved.auth['openrouter-head'], 'api-key');
  assert.equal(saved.models['openrouter-head'], 'nvidia/nemotron-trinity-plus');
  assert.equal(saved.roles['openrouter-head'], 'code');
}

async function testHydraFile(rootDir) {
  let hydraFile = readHydraFile(rootDir);
  assert.equal(hydraFile.validation.valid, true);

  await append_entry('MEMORY', 'smoke', 'Use append-only project memory.', rootDir);
  hydraFile = readHydraFile(rootDir);
  assert.equal(hydraFile.sections.MEMORY.at(-1).content, 'Use append-only project memory.');
}

async function testContextBuilder(rootDir) {
  await append_entry('MEMORY', 'smoke', 'MEMORY CLEARED -- prior memory entries ignored from this point forward.', rootDir);
  await append_entry('MEMORY', 'smoke', 'Current active memory note.', rootDir);

  const active = activeMemoryEntries(readHydraFile(rootDir).sections.MEMORY);
  assert.equal(active.length, 1);
  assert.equal(active[0].content, 'Current active memory note.');

  const geminiHead = {
    id: 'gemini',
    name: 'Gemini',
    tag: '[GEMINI]',
    providerId: 'google-gemini',
    defaultModel: 'gemini-2.5-flash-lite',
  };
  const built = buildSystemContext({
    head: geminiHead,
    prompt: 'Use the active memory note.',
    connectedHeads: [{ ...geminiHead, connected: true }],
    root: rootDir,
  });

  assert.match(built.context, /SYSTEM CONTEXT/);
  assert.equal(built.metadata.relevantMemoryCount, 1);
}

function testDecisionScoring() {
  assert.equal(scoreDifference('same words here', 'same words here'), 0);
  assert.equal(responsesAreDifferent([
    { head: 'claude', content: 'Use Express with route modules and middleware.' },
    { head: 'codex', content: 'Use Fastify with plugins and schemas.' },
  ]), true);
  assert.equal(responsesAreDifferent([
    { head: 'claude', content: 'Use route modules and tests.' },
    { head: 'codex', content: 'Use route modules and tests.' },
  ]), false);
}

async function testBudget(rootDir) {
  await enableBudget(1, rootDir);
  await setBudgetAlert(50, rootDir);
  await setBudgetLimit(2, rootDir);
  assert.equal(await addBudget(1, rootDir), 3);

  const usage = await recordBudgetUsage({
    head: 'codex',
    model: 'gpt-4o',
    tokens: 1000,
    root: rootDir,
  });
  assert.ok(usage.cost > 0);
  assert.equal(budgetThreshold(rootDir).state, 'ok');

  await pauseMeteredHeads(['codex'], rootDir);
  assert.equal(shouldPauseHead('codex', rootDir), true);
  await resumeAllHeads(rootDir);
  assert.equal(shouldPauseHead('codex', rootDir), false);

  await resetBudget(rootDir);
  await disableBudget(rootDir);
}

async function testPermissions(rootDir) {
  await resetPermissions(rootDir);
  assert.equal(evaluateFileRead('src/cli.js', rootDir).allowed, true);
  assert.equal(evaluateFileWrite('src/cli.js', rootDir).approvalRequired, true);
  assert.equal(evaluateFileRead('..', rootDir).approvalRequired, true);

  await setPermissionLevel(2, { root: rootDir });
  assert.equal(evaluateFileWrite('src/cli.js', rootDir).allowed, true);

  assert.equal(allowPath('src', rootDir), true);
  assert.equal(allowPath('..', rootDir), false);

  allowCommandOnce('npm test');
  assert.equal(evaluateCommandExecution('npm test', rootDir).allowed, true);
  assert.equal(evaluateCommandExecution('npm test', rootDir).approvalRequired, true);
  assert.equal(isDestructiveShellCommand('git reset --hard'), true);
}

function testCommandRegistry() {
  const heads = [
    { id: 'head1', name: 'Head One', aliases: ['primary', 'help'] },
    { id: 'codex', name: 'Codex', aliases: ['coder'] },
  ];

  const help = resolveCommandName('/help', heads);
  assert.equal(help.type, 'builtin');
  assert.equal(help.definition, BUILTIN_COMMANDS.help);

  const remove = resolveCommandName('/remove', heads);
  assert.equal(remove.type, 'builtin');
  assert.equal(remove.definition, BUILTIN_COMMANDS.remove);

  const advisor = resolveCommandName('/advisor', heads);
  assert.equal(advisor.type, 'role');
  assert.equal(advisor.definition, ROLE_COMMANDS.advisor);

  const oracle = resolveCommandName('/oracle', heads);
  assert.equal(oracle.type, 'role');
  assert.equal(oracle.definition, ROLE_COMMANDS.oracle);

  const primary = resolveCommandName('/primary', heads);
  assert.equal(primary.type, 'nickname');
  assert.equal(primary.head.id, 'head1');

  const head1 = resolveCommandName('/head1', heads);
  assert.equal(head1.type, 'head');
  assert.equal(head1.head.id, 'head1');

  const codex = resolveCommandName('/codex', heads);
  assert.equal(codex.type, 'head');
  assert.equal(codex.head.id, 'codex');

  const coder = resolveCommandName('/coder', heads);
  assert.equal(coder.type, 'nickname');
  assert.equal(coder.head.id, 'codex');

  const unknown = resolveCommandName('/advsior', heads);
  assert.equal(unknown.type, 'unknown');
  assert.ok(unknown.suggestions.includes('advisor'));

  assert.equal(isReservedCommandName('help'), true);
  const helpNickname = getNicknameEntries(heads).find((entry) => entry.alias === 'help');
  assert.equal(helpNickname.reserved, true);

  const quit = resolveCommandName('/quit', heads);
  assert.equal(quit.type, 'builtin');
  assert.equal(quit.definition.aliasFor, 'exit');

  const reset = resolveCommandName('/reset', heads);
  assert.equal(reset.type, 'builtin');
  assert.equal(reset.definition.aliasFor, 'clear');

  const summarize = resolveCommandName('/summarize', heads);
  assert.equal(summarize.type, 'builtin');
  assert.equal(summarize.definition.aliasFor, 'compact');
}

function testModelDisplay() {
  assert.equal(formatModelShortName('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(formatModelShortName('claude-opus-4-7'), 'Opus 4.7');
  assert.equal(formatModelShortName('gpt-4o'), 'GPT-4o');
  assert.equal(formatModelShortName('gemini-2.5-flash-lite'), 'Flash Lite');
  assert.equal(formatModelShortName('google/gemini-2.0-flash-001:free'), 'Flash 2.0');
  assert.equal(formatModelShortName('google/gemini-flash-1.5-8b:free'), 'Flash 1.5 8B');
  assert.equal(formatModelShortName('meta-llama/llama-3.3-70b-instruct'), 'Llama 3.3 70B');
  assert.equal(formatModelShortName('nvidia/nemotron-trinity-plus'), 'TrinityPlus');
  assert.equal(formatModelShortName('openai/gpt-oss-120b'), 'GPT Oss 120B');
}

function testHeadDisplay() {
  const repurposedGemini = {
    id: 'gemini',
    name: 'Gemini',
    tag: '[GEMINI]',
    providerId: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/owl-alpha',
    builtin: true,
  };
  assert.equal(isRepurposedBuiltinHead(repurposedGemini), true);
  assert.equal(formatHeadDisplayName(repurposedGemini), 'Owl Alpha');
  assert.equal(formatHeadDisplayTag(repurposedGemini), '[OWL ALPHA]');

  const normalGemini = {
    ...repurposedGemini,
    providerId: 'google-gemini',
    baseUrl: null,
    defaultModel: 'gemini-2.5-flash-lite',
  };
  assert.equal(isRepurposedBuiltinHead(normalGemini), false);
  assert.equal(formatHeadDisplayTag(normalGemini), '[GEMINI]');
}

function testPromptHeadIndicatorGrid() {
  const models = [
    'claude-sonnet-4-20250514',
    'gpt-4o',
    'google/gemini-flash-1.5-8b:free',
    'nvidia/nemotron-trinity-plus',
    'meta-llama/llama-3.1-8b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemini-2.0-flash-001:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemini-flash-1.5-8b:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'nvidia/nemotron-trinity-plus',
    'gpt-4o',
  ];
  const heads = models.map((model, index) => ({
    id: `head${index + 1}`,
    name: `Head ${index + 1}`,
    tag: `[HEAD${index + 1}]`,
    model,
    color: 'white',
    callable: true,
    connected: true,
  }));
  const rendered = formatPromptHeadIndicator(heads, 80);
  const lines = rendered.split('\n');
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => visibleTextLength(line) <= 80));
  assert.deepEqual(lines.map(visibleTextLength), Array(lines.length).fill(visibleTextLength(lines[0])));
  assert.doesNotMatch(rendered, /heads - \/hydra heads to list/);
}

function testHeadPaletteCycles(rootDir) {
  const paletteRoot = path.join(rootDir, 'palette-cycle');
  ensureProjectState(paletteRoot);
  refreshHeadsRegistry();

  for (let index = 0; index < 12; index += 1) {
    addHeadToRegistry({
      id: `custom${index + 1}`,
      name: `Custom ${index + 1}`,
      tag: `[CUSTOM${index + 1}]`,
      providerId: 'openai',
      envKey: 'OPENAI_API_KEY',
      defaultModel: 'gpt-4o',
      aliases: [],
      baseUrl: null,
      builtin: false,
    }, paletteRoot);
  }

  refreshHeadsRegistry();
  const colors = listHeads(paletteRoot).map((head) => head.color);
  assert.deepEqual(colors.slice(0, 12), Array.from({ length: 12 }, (_, index) => COLOR_PALETTE[index % COLOR_PALETTE.length]));

  removeHeadFromRegistry('custom1', paletteRoot);
  refreshHeadsRegistry();
  const shiftedColors = listHeads(paletteRoot).map((head) => head.color);
  assert.deepEqual(shiftedColors.slice(0, 11), Array.from({ length: 11 }, (_, index) => COLOR_PALETTE[index % COLOR_PALETTE.length]));
}

function testDashboardResponseLabels() {
  const headsById = new Map([[
    'gemini',
    {
      id: 'gemini',
      name: 'Gemini',
      tag: '[GEMINI]',
      providerId: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/owl-alpha',
      defaultModel: 'openrouter/owl-alpha',
      builtin: true,
    },
  ]]);
  const label = formatDashboardResponseLabel({
    headId: 'gemini',
    at: 0,
    model: 'openrouter/owl-alpha',
    text: 'Hello',
  }, headsById);
  assert.match(label, /^\[OWL ALPHA\]/);
  assert.match(label, /Owl Alpha/);
  assert.doesNotMatch(label, /openrouter\/owl-alpha/);
  assert.doesNotMatch(label, /\[GEMINI\]/);
}

function testDashboardPromptPinning() {
  assert.deepEqual(
    pinDashboardBlockToBottom(['top', 'middle'], ['Prompt', '> hello'], 6),
    ['top', 'middle', '', '', 'Prompt', '> hello'],
  );
  assert.deepEqual(
    pinDashboardBlockToBottom(['a', 'b', 'c'], ['Prompt', '> hello'], 4),
    ['a', 'b', 'Prompt', '> hello'],
  );
}

function testDashboardPromptBlock() {
  const rawWidth = 80;
  const width = dashboardContentWidth(rawWidth);
  assert.equal(width, rawWidth - 4);
  const lines = renderPromptBlock({
    busy: false,
    inputBuffer: 'typing '.repeat(20),
    termWidth: width,
    suggestions: ['/help', '/heads'],
    suggestionIndex: 0,
  });
  assert.ok(lines.every((line) => stripAnsi(line).length <= width));
  assert.ok(lines.every((line) => stripAnsi(line).length < rawWidth));
  assert.ok(lines.every((line) => !stripAnsi(line).includes('▏')));
  assert.equal(promptInputCursorColumn('abc', width), 6);
  assert.ok(promptInputCursorColumn('typing '.repeat(20), width) <= width);
}

function testDashboardResponseWrapping() {
  const headsById = new Map([[
    'gemini',
    {
      id: 'gemini',
      name: 'Gemini',
      tag: '[GEMINI]',
      providerId: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/owl-alpha',
      defaultModel: 'openrouter/owl-alpha',
      builtin: true,
    },
  ]]);
  const lines = formatDashboardResponseLines({
    headId: 'gemini',
    at: Date.now(),
    model: 'openrouter/owl-alpha',
    prompt: 'user prompt '.repeat(12),
    text: `AI response ${'longword'.repeat(10)} ${'more text '.repeat(12)}`,
  }, headsById, 42, 5);
  assert.ok(lines.length <= 5);
  assert.ok(lines.every((line) => stripAnsi(line).length <= 42));
  const bodyLine = lines.map(stripAnsi).find((line) => line.includes('AI response'));
  assert.ok(bodyLine.startsWith('      AI response'));
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function testProviderCommands() {
  assert.equal(resolveHeadRole('advisor').key, 'advisor');
  assert.equal(resolveHeadRole('architect').key, 'architect');
  assert.equal(resolveHeadRole('code').key, 'code');
  assert.equal(resolveHeadRole('finance').key, 'finance');
  assert.equal(resolveHeadRole('advisor').color, 'purple');
  assert.equal(resolveHeadRole('code').color, 'white');
  assert.equal(resolveHeadRole('research').color, 'blue');
  assert.match(formatRoleContext('advisor'), /high-level guidance/);
  assert.match(formatRoleContext('accountant'), /licensed tax or financial authority/);
  assert.equal(resolveHeadModel('claude', 'opus').model, 'claude-opus-4-7');
  assert.equal(resolveHeadModel('claude', 'opus47').model, 'claude-opus-4-7');
  assert.equal(resolveHeadModel('codex', 'gpt55').model, 'gpt-5.5');
  assert.equal(resolveHeadModel('gemini', 'pro').model, 'gemini-3-pro-preview');
  const roleLine = formatProviderCommandHelp('codex').split('\n').find((line) => line.startsWith('Roles:'));
  const roleNames = roleLine.replace(/^Roles:\s+/, '').split(', ');
  assert.deepEqual(roleNames, [...roleNames].sort((a, b) => a.localeCompare(b)));
}

function testNativeCommands() {
  assert.equal(resolveNativeProvider('claude-code'), 'claude');
  assert.equal(resolveNativeProvider('codex-cli'), 'codex');
  assert.match(formatNativeCommandHelp(), /native claude --help/);
  assert.ok(getToolDefinitions().some((tool) => tool.name === 'run_native_cli'));
}

function testHeadActivityResponses() {
  resetActivity();
  markStart('codex', { prompt: 'Say hi', model: 'gpt-4o' });
  markEnd('codex', {
    prompt: 'Say hi',
    text: 'Hello from Codex.',
    preview: 'Hello from Codex.',
    model: 'gpt-4o',
    tokens: 12,
  });
  const recent = getRecentResponses(1);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].headId, 'codex');
  assert.equal(recent[0].text, 'Hello from Codex.');
  resetActivity();
}

function testResponsiveLogo() {
  assert.equal(bestLogoMode('full', 120), 'full');
  assert.equal(bestLogoMode('full', 28), 'compact');
  assert.equal(bestLogoMode('full', 26), 'tiny');
  assert.equal(bestLogoMode('compact', 10), 'tiny');
  assert.match(centerLine('HYDRA', 24), /^\s+HYDRA$/);
  assert.match(centerBlock('A\nBB', 10), /^\s+A\n\s+BB$/);
  assert.equal(bestTitleMode(120), 'wide');
  assert.equal(bestTitleMode(55), 'full');
  assert.equal(bestTitleMode(40), 'medium');
  assert.equal(bestTitleMode(10), 'small');
}

function testCompletion() {
  const heads = listHeads();
  const headCount = heads.length;
  if (headCount > 0) {
    const firstHead = heads[0].id;
    const [modeHits] = hydraCompleter('/hydra mode solo ');
    assert.ok(modeHits.includes(`/hydra mode solo ${firstHead}`));

    const [upperHits] = hydraCompleter('/HYDRA MODE SOLO ');
    assert.ok(upperHits.includes(`/hydra mode solo ${firstHead}`));

    const [authHits] = hydraCompleter(`/hydra auth ${firstHead.slice(0, 3)}`);
    assert.ok(authHits.includes(`/hydra auth ${firstHead} api-key`));
  }

  const [workflowAliasHits] = hydraCompleter('/wf');
  assert.ok(workflowAliasHits.includes('/wf status'));

  const [chatAliasHits] = hydraCompleter('/cha');
  assert.ok(chatAliasHits.includes('/chat'));

  const [rootRoleHits] = hydraCompleter('/adv');
  assert.ok(rootRoleHits.includes('/advisor'));
  assert.ok(rootRoleHits.includes('/advisor "prompt"'));

  const [rolesHits] = hydraCompleter('/rol');
  assert.ok(rolesHits.includes('/roles'));

  const [roleClearHits] = hydraCompleter('/roles clear ');
  assert.ok(roleClearHits.includes('/roles clear all'));
  if (headCount > 0) {
    assert.ok(roleClearHits.includes('/roles clear head 1'));
  }
  assert.equal(roleClearHits.includes('/roles clear claude'), false);
  assert.equal(roleClearHits.includes('/roles clear codex'), false);
  assert.equal(roleClearHits.includes('/roles clear gemini'), false);

  const [setupHeadHits] = hydraCompleter('/setup head ');
  assert.ok(setupHeadHits.includes('/setup head new'));
  if (headCount > 0) {
    assert.ok(setupHeadHits.includes(`/setup head ${headCount}`));
  }
  assert.equal(setupHeadHits.includes('/setup head claude'), false);

  const [removeHeadHits] = hydraCompleter('/remove head ');
  if (headCount > 0) {
    assert.ok(removeHeadHits.includes('/remove head 1'));
    assert.ok(removeHeadHits.includes(`/remove head ${headCount}`));
  }
  assert.equal(removeHeadHits.includes('/remove head claude'), false);

  const [advisorHits] = hydraCompleter('/hydra adv');
  assert.ok(advisorHits.includes('/hydra advisor'));
  assert.ok(advisorHits.includes('/hydra advisor opus'));

  const [upperAdvisorHits] = hydraCompleter('/HYDRA ADV');
  assert.ok(upperAdvisorHits.includes('/hydra advisor'));

  if (heads.some((head) => head.id === 'claude')) {
    const [providerHits] = hydraCompleter('/hydra claude adv');
    assert.ok(providerHits.includes('/hydra claude advisor opus'));

    const [upperProviderHits] = hydraCompleter('/HYDRA CLAUDE ADV');
    assert.ok(upperProviderHits.includes('/hydra claude advisor opus'));
  }
  if (heads.some((head) => head.id === 'gemini')) {
    const [authHits] = hydraCompleter('/hydra auth gem');
    assert.ok(authHits.includes('/hydra auth gemini api-key'));

    const candidates = completionCandidates('/hydra gemini research');
    assert.ok(candidates.includes('/hydra gemini research pro'));
  }
  const candidates = completionCandidates('/hydra advisor');
  assert.ok(candidates.includes('/code'));
  assert.ok(candidates.includes('/hydra code'));
  if (headCount > 0) {
    assert.ok(candidates.includes('/head1'));
  }

  assert.equal(isCompleteCommand('/hydra allow writes this-session'), true);
  assert.equal(isCompleteCommand('/HYDRA ALLOW WRITES THIS-SESSION'), true);
  assert.equal(isCompleteCommand('/hydra allow writes this'), false);
  assert.equal(isCompleteCommand('/advisor'), true);
  assert.equal(isCompleteCommand('/quit'), true);
}

async function testSubscriptionAdapter(rootDir) {
  const binDir = path.join(rootDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const fakeName = 'hydra-fake-subscription-cli';
  const fakeScript = path.join(binDir, `${fakeName}.js`);
  fs.writeFileSync(fakeScript, [
    'const args = process.argv.slice(2);',
    "if (args[0] === '--version') {",
    "  console.log('fake-sub 1.0.0');",
    '  process.exit(0);',
    '}',
    "process.stdin.setEncoding('utf8');",
    "let stdin = '';",
    "process.stdin.on('data', (chunk) => { stdin += chunk; });",
    "process.stdin.on('end', () => {",
    '  console.log(JSON.stringify({ args, stdin }));',
    '});',
    '',
  ].join('\n'));

  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(binDir, `${fakeName}.cmd`),
      `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`,
    );
  } else {
    const fakeBinary = path.join(binDir, fakeName);
    fs.writeFileSync(
      fakeBinary,
      `#!/usr/bin/env sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`,
    );
    fs.chmodSync(fakeBinary, 0o755);
  }

  const previousPath = process.env.PATH || '';
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
  resetSubscriptionBinaryCache();

  try {
    const detection = detectSubscriptionBinary(fakeName);
    assert.equal(detection.available, true);
    assert.match(detection.version, /fake-sub 1\.0\.0/);
    assert.ok(detection.resolvedBinary);

    const adapter = new SubscriptionAdapter(
      { id: 'fake', name: 'Fake Subscription', defaultModel: 'fake-model' },
      {
        HYDRA_FAKE_BIN: fakeName,
        HYDRA_FAKE_TIMEOUT_MS: '5000',
      },
      {
        binaryEnvVar: 'HYDRA_FAKE_BIN',
        timeoutEnvVar: 'HYDRA_FAKE_TIMEOUT_MS',
        defaultBinary: fakeName,
        defaultTimeoutMs: 5000,
        argsForPrompt: () => ['run'],
        stdinForPrompt: true,
      },
    );

    assert.equal(await adapter.connect(), true);
    const response = await adapter.sendPrompt('context', 'say hi');
    assert.deepEqual(JSON.parse(response.text), {
      args: ['run'],
      stdin: 'context\n\nsay hi',
    });
  } finally {
    process.env.PATH = previousPath;
    resetSubscriptionBinaryCache();
  }
}
