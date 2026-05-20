import fs from 'node:fs';
import path from 'node:path';
import { getProjectPaths } from './project.js';
import {
  newMetadata,
  validateArchitectureContract,
  validateDecisionLog,
  validateGateSummary,
  validateImplementationNotes,
  validateOwnershipMap,
  validateTaskBrief,
} from './artifact-schemas.js';

export function newTaskId(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `HYD-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export function getTaskPaths(taskId, root = process.cwd()) {
  const paths = getProjectPaths(root);
  const taskDir = path.join(paths.artifactsDir, taskId);
  return {
    root: paths.root,
    taskDir,
    lineageLog: path.join(taskDir, 'lineage.jsonl'),
    deliverablesDir: path.join(paths.deliverablesDir, taskId),
  };
}

export function ensureTaskState(taskId, root = process.cwd()) {
  const paths = getTaskPaths(taskId, root);
  fs.mkdirSync(paths.taskDir, { recursive: true });
  return paths;
}

export function writeArtifact(taskId, name, body, root = process.cwd()) {
  const paths = ensureTaskState(taskId, root);
  const target = path.join(paths.taskDir, name);
  fs.writeFileSync(target, body, 'utf8');
  return target;
}

export function readArtifact(taskId, name, root = process.cwd()) {
  const paths = getTaskPaths(taskId, root);
  const target = path.join(paths.taskDir, name);
  if (!fs.existsSync(target)) return null;
  return fs.readFileSync(target, 'utf8');
}

export function appendLineage(taskId, event, root = process.cwd()) {
  const paths = ensureTaskState(taskId, root);
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...event,
  });
  fs.appendFileSync(paths.lineageLog, `${line}\n`, 'utf8');
}

export function readLineage(taskId, root = process.cwd()) {
  const paths = getTaskPaths(taskId, root);
  if (!fs.existsSync(paths.lineageLog)) return [];
  return fs.readFileSync(paths.lineageLog, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

export function listTaskIds(root = process.cwd()) {
  const paths = getProjectPaths(root);
  if (!fs.existsSync(paths.artifactsDir)) return [];
  return fs.readdirSync(paths.artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^HYD-\d{8}-\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function buildDecisionLog({
  taskId,
  checkpoint = 'C',
  riskLevel = 'medium',
  roleTag,
  prompt,
  responses,
  judge,
  userChoice,
}) {
  const metadata = newMetadata({
    taskId,
    artifact: 'decision_log',
    ownerRole: 'judge',
    status: 'ready',
    producedInPhase: 'judge_verify_checkpoint_c',
    consumedByPhase: 'user_result',
  });
  const optionsEvaluated = responses.map((response, index) => ({
    name: String.fromCharCode(65 + index),
    head: response.head,
    summary: previewText(response.text, 800),
    pros: [],
    cons: [],
    evidence_refs: response.implementation_notes_ref ? [response.implementation_notes_ref] : [],
    evidence_status: response.implementation_notes_ref ? 'verified_static' : 'unverified',
    security_status: 'clear',
    implementation_notes_ok: response.implementation_notes?.ok ?? null,
    ownership_violations: Array.isArray(response.ownership_violations) ? response.ownership_violations : [],
  }));
  const selectedName = judge.action === 'pick' && judge.selected_option ? judge.selected_option : (judge.action === 'synthesize' ? 'synthesized' : '');
  const rejected = optionsEvaluated
    .filter((option) => option.name !== selectedName)
    .map((option) => ({ name: option.name, reason: 'not selected by judge' }));
  const artifact = {
    ...metadata,
    checkpoint,
    risk_level: riskLevel,
    role_tag: roleTag,
    user_prompt: previewText(prompt, 2000),
    criteria: ['judge_picked_or_synthesized'],
    options_evaluated: optionsEvaluated,
    selected: selectedName,
    synthesized: judge.action === 'synthesize' ? judge.synthesized : null,
    rejected,
    deferred_decisions: [],
    confidence_level: judge.confidence,
    unverified_claims: [],
    security_veto: false,
    requires_user_approval: judge.action === 'ask_user' || judge.confidence === 'low',
    user_question: judge.user_question,
    user_choice: userChoice?.action || null,
    judge_reasoning: judge.reasoning,
    risks: judge.risks || [],
    next_action: judge.action === 'ask_user' ? 'await_user' : (userChoice?.action === 'accept' ? 'accepted' : 'pending'),
  };
  return artifact;
}

export function writeDecisionLog(taskId, artifact, root = process.cwd()) {
  const validation = validateDecisionLog(artifact);
  const body = JSON.stringify(artifact, null, 2);
  const target = writeArtifact(taskId, 'decision_log.json', body, root);
  return { path: target, validation };
}

export function buildGateSummary({
  taskId,
  gate,
  status,
  updatedArtifacts = [],
  blockers = [],
  conflicts = [],
  judgeCheckpointRequired = false,
  backtracksUsedInPhase = 0,
  nextGate = null,
  notes = '',
}) {
  const metadata = newMetadata({
    taskId,
    artifact: 'gate_summary',
    ownerRole: 'oracle',
    status: 'ready',
    producedInPhase: gate,
    consumedByPhase: nextGate,
  });
  return {
    ...metadata,
    gate,
    status,
    updated_artifacts: updatedArtifacts,
    blockers,
    conflicts,
    judge_checkpoint_required: judgeCheckpointRequired,
    backtracks_used_in_phase: backtracksUsedInPhase,
    next_gate: nextGate,
    notes,
  };
}

export function writeGateSummary(taskId, artifact, root = process.cwd()) {
  const validation = validateGateSummary(artifact);
  const body = toMinimalYaml(artifact);
  const target = writeArtifact(taskId, `gate_${artifact.gate}.yaml`, body, root);
  return { path: target, validation };
}

export function buildTaskBrief({
  taskId,
  goal,
  nonGoals = [],
  acceptanceCriteria = [],
  riskLevel = 'medium',
  approvalPolicy = 'recommend',
  constraints = [],
  assumptions = [],
  repoArea = [],
}) {
  const metadata = newMetadata({
    taskId,
    artifact: 'task_brief',
    ownerRole: 'oracle',
    status: 'draft',
    producedInPhase: 'intake',
    consumedByPhase: 'architecture_gate',
  });
  return {
    ...metadata,
    goal,
    non_goals: nonGoals,
    acceptance_criteria: acceptanceCriteria,
    risk_level: riskLevel,
    approval_policy: approvalPolicy,
    constraints,
    assumptions,
    repo_area: repoArea,
  };
}

export function writeTaskBrief(taskId, artifact, root = process.cwd()) {
  const validation = validateTaskBrief(artifact);
  const body = renderTaskBriefMarkdown(artifact);
  const target = writeArtifact(taskId, 'task_brief.md', body, root);
  return { path: target, validation };
}

export function buildArchitectureContract({
  taskId,
  ownerHead = null,
  componentsChanged = [],
  boundaries = [],
  interfaces = { unchanged: true },
  invariants = [],
  ownershipSuggestions = [],
  failureModes = [],
  testStrategy = '',
  securityOpsConsiderations = [],
  tradeoffs = { chosen: '', alternatives: [], why_rejected: [] },
  deferredDecisions = [],
  notes = '',
  briefInputVersion = 1,
}) {
  const metadata = newMetadata({
    taskId,
    artifact: 'architecture_contract',
    ownerRole: 'architect',
    status: 'ready',
    producedInPhase: 'architecture_gate',
    consumedByPhase: 'ownership_gate',
  });
  return {
    ...metadata,
    owner_head: ownerHead,
    inputs: [{ artifact: 'task_brief', version: briefInputVersion }],
    components_changed: componentsChanged,
    boundaries,
    interfaces,
    invariants,
    ownership_suggestions: ownershipSuggestions,
    failure_modes: failureModes,
    test_strategy: testStrategy,
    security_ops_considerations: securityOpsConsiderations,
    tradeoffs,
    deferred_decisions: deferredDecisions,
    notes,
  };
}

export function buildOwnershipMap({
  taskId,
  tracks = [],
  sharedFiles = [],
  crossCuttingChanges = [],
  notes = '',
  briefInputVersion = 1,
  architectureInputVersion = 1,
}) {
  const metadata = newMetadata({
    taskId,
    artifact: 'ownership_map',
    ownerRole: 'oracle',
    status: 'ready',
    producedInPhase: 'ownership_gate',
    consumedByPhase: 'parallel_build',
  });
  return {
    ...metadata,
    inputs: [
      { artifact: 'task_brief', version: briefInputVersion },
      { artifact: 'architecture_contract', version: architectureInputVersion },
    ],
    tracks,
    shared_files: sharedFiles,
    cross_cutting_changes: crossCuttingChanges,
    notes,
  };
}

export function writeOwnershipMap(taskId, artifact, root = process.cwd()) {
  const validation = validateOwnershipMap(artifact);
  const target = writeArtifact(taskId, 'ownership_map.json', JSON.stringify(artifact, null, 2), root);
  return { path: target, validation };
}

export function buildImplementationNotes({
  taskId,
  ownerHead = null,
  ownerRole = 'code',
  trackId = '',
  filesChanged = [],
  summary = '',
  assumptions = [],
  rollbackNotes = '',
  verificationSuggested = [],
  status = 'ready',
  parseOk = true,
  ownershipValidation = null,
  briefInputVersion = 1,
  architectureInputVersion = 1,
  ownershipInputVersion = 1,
}) {
  const metadata = newMetadata({
    taskId,
    artifact: 'implementation_notes',
    ownerRole,
    status,
    producedInPhase: 'parallel_build',
    consumedByPhase: 'integration_check',
  });
  return {
    ...metadata,
    owner_head: ownerHead,
    inputs: [
      { artifact: 'task_brief', version: briefInputVersion },
      { artifact: 'architecture_contract', version: architectureInputVersion },
      { artifact: 'ownership_map', version: ownershipInputVersion },
    ],
    track_id: trackId,
    files_changed: filesChanged,
    summary,
    assumptions,
    rollback_notes: rollbackNotes,
    verification_suggested: verificationSuggested,
    parse_ok: parseOk,
    ownership_validation: ownershipValidation,
  };
}

export function writeImplementationNotes(taskId, artifact, root = process.cwd(), { ownershipMap = null } = {}) {
  const validation = validateImplementationNotes(artifact, { ownershipMap });
  const target = writeArtifact(taskId, implementationNotesFileName(artifact.owner_head), renderImplementationNotesMarkdown(artifact), root);
  return { path: target, validation };
}

export function implementationNotesFileName(ownerHead) {
  const suffix = String(ownerHead || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
  return `implementation_notes_${suffix}.md`;
}

export function writeArchitectureContract(taskId, artifact, root = process.cwd()) {
  const validation = validateArchitectureContract(artifact);
  const md = renderArchitectureMarkdown(artifact);
  const mdTarget = writeArtifact(taskId, 'architecture_contract.md', md, root);
  const jsonTarget = writeArtifact(taskId, 'architecture_contract.json', JSON.stringify(artifact, null, 2), root);
  return { path: mdTarget, jsonPath: jsonTarget, validation };
}

function renderArchitectureMarkdown(artifact) {
  const frontmatter = toMinimalYaml({
    task_id: artifact.task_id,
    artifact: artifact.artifact,
    owner_role: artifact.owner_role,
    owner_head: artifact.owner_head,
    version: artifact.version,
    status: artifact.status,
    produced_in_phase: artifact.produced_in_phase,
    consumed_by_phase: artifact.consumed_by_phase,
    inputs: artifact.inputs,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
  });
  const lines = [
    '---',
    frontmatter.trimEnd(),
    '---',
    '',
    '# Architecture Contract',
    '',
    '## Components / Modules Changed',
    ...(artifact.components_changed.length ? artifact.components_changed.map((item) => `- ${item}`) : ['- (none)']),
    '',
    '## Boundaries',
    ...(artifact.boundaries.length ? artifact.boundaries.map((item) => `- ${item}`) : ['- (no boundary changes)']),
    '',
    '## Interfaces',
  ];
  if (artifact.interfaces?.unchanged) {
    lines.push('- No interface changes.');
  } else {
    const newOnes = Array.isArray(artifact.interfaces?.new) ? artifact.interfaces.new : [];
    const changed = Array.isArray(artifact.interfaces?.changed) ? artifact.interfaces.changed : [];
    if (newOnes.length) {
      lines.push('- New:');
      for (const entry of newOnes) lines.push(`  - ${entry}`);
    }
    if (changed.length) {
      lines.push('- Changed:');
      for (const entry of changed) lines.push(`  - ${entry}`);
    }
    if (!newOnes.length && !changed.length) lines.push('- (none)');
  }
  lines.push('');
  lines.push('## Invariants');
  lines.push(...(artifact.invariants.length ? artifact.invariants.map((item) => `- ${item}`) : ['- (none stated)']));
  lines.push('');
  lines.push('## Ownership Suggestions');
  lines.push(...(artifact.ownership_suggestions.length ? artifact.ownership_suggestions.map((item) => `- ${item}`) : ['- (none)']));
  lines.push('');
  lines.push('## Failure Modes');
  lines.push(...(artifact.failure_modes.length ? artifact.failure_modes.map((item) => `- ${item}`) : ['- (none identified)']));
  lines.push('');
  lines.push('## Test Strategy');
  lines.push(artifact.test_strategy || '(none stated)');
  lines.push('');
  lines.push('## Security / Ops Considerations');
  lines.push(...(artifact.security_ops_considerations.length ? artifact.security_ops_considerations.map((item) => `- ${item}`) : ['- (none)']));
  lines.push('');
  lines.push('## Tradeoffs');
  if (artifact.tradeoffs?.chosen) lines.push(`- Chosen: ${artifact.tradeoffs.chosen}`);
  if (Array.isArray(artifact.tradeoffs?.alternatives) && artifact.tradeoffs.alternatives.length) {
    lines.push('- Alternatives:');
    for (const alt of artifact.tradeoffs.alternatives) lines.push(`  - ${alt}`);
  }
  if (Array.isArray(artifact.tradeoffs?.why_rejected) && artifact.tradeoffs.why_rejected.length) {
    lines.push('- Why rejected:');
    for (const reason of artifact.tradeoffs.why_rejected) lines.push(`  - ${reason}`);
  }
  lines.push('');
  lines.push('## Deferred Decisions');
  lines.push(...(artifact.deferred_decisions.length ? artifact.deferred_decisions.map((item) => `- ${item}`) : ['- (none)']));
  if (artifact.notes) {
    lines.push('');
    lines.push('## Notes');
    lines.push(artifact.notes);
  }
  lines.push('');
  return lines.join('\n');
}

function renderImplementationNotesMarkdown(artifact) {
  const frontmatter = toMinimalYaml({
    task_id: artifact.task_id,
    artifact: artifact.artifact,
    owner_role: artifact.owner_role,
    owner_head: artifact.owner_head,
    version: artifact.version,
    status: artifact.status,
    produced_in_phase: artifact.produced_in_phase,
    consumed_by_phase: artifact.consumed_by_phase,
    inputs: artifact.inputs,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
  });
  const lines = [
    '---',
    frontmatter.trimEnd(),
    '---',
    '',
    '# Implementation Notes',
    '',
    '## Track',
    artifact.track_id || '(missing)',
    '',
    '## Files Changed',
  ];
  if (artifact.files_changed.length) {
    for (const file of artifact.files_changed) {
      lines.push(`- path: ${file.path || ''}`);
      lines.push(`  change: ${file.change || ''}`);
      lines.push(`  reason: ${file.reason || ''}`);
    }
  } else {
    lines.push('- (none provided)');
  }
  lines.push('');
  lines.push('## Summary');
  lines.push(artifact.summary || '(none provided)');
  lines.push('');
  lines.push('## Assumptions');
  lines.push(...(artifact.assumptions.length ? artifact.assumptions.map((item) => `- ${item}`) : ['- (none)']));
  lines.push('');
  lines.push('## Rollback Notes');
  lines.push(artifact.rollback_notes || '(none provided)');
  lines.push('');
  lines.push('## Verification Suggested');
  if (artifact.verification_suggested.length) {
    for (const check of artifact.verification_suggested) {
      lines.push(`- command: ${check.command || ''}`);
      lines.push(`  expected: ${check.expected || ''}`);
    }
  } else {
    lines.push('- (none provided)');
  }
  if (artifact.ownership_validation) {
    lines.push('');
    lines.push('## Ownership Validation');
    lines.push(`- ok: ${Boolean(artifact.ownership_validation.ok)}`);
    const violations = Array.isArray(artifact.ownership_validation.violations) ? artifact.ownership_validation.violations : [];
    if (violations.length) {
      for (const violation of violations) {
        lines.push(`- ${violation.kind}: ${violation.path}`);
      }
    } else {
      lines.push('- violations: none');
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderTaskBriefMarkdown(artifact) {
  const frontmatter = toMinimalYaml({
    task_id: artifact.task_id,
    artifact: artifact.artifact,
    owner_role: artifact.owner_role,
    version: artifact.version,
    status: artifact.status,
    produced_in_phase: artifact.produced_in_phase,
    consumed_by_phase: artifact.consumed_by_phase,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
  });
  const lines = [
    '---',
    frontmatter.trimEnd(),
    '---',
    '',
    '# Task Brief',
    '',
    '## Goal',
    artifact.goal,
    '',
    '## Non-goals',
    ...(artifact.non_goals.length ? artifact.non_goals.map((item) => `- ${item}`) : ['- (none)']),
    '',
    '## Acceptance Criteria',
    ...artifact.acceptance_criteria.map((item) => `- [ ] ${item}`),
    '',
    `## Risk Level`,
    artifact.risk_level,
    '',
    `## Approval Policy`,
    artifact.approval_policy,
    '',
    '## Constraints',
    ...(artifact.constraints.length ? artifact.constraints.map((item) => `- ${item}`) : ['- (none)']),
    '',
    '## Assumptions',
    ...(artifact.assumptions.length ? artifact.assumptions.map((item) => `- ${item}`) : ['- (none)']),
    '',
    '## Repo Area',
    ...(artifact.repo_area.length ? artifact.repo_area.map((item) => `- ${item}`) : ['- (none)']),
    '',
  ];
  return lines.join('\n');
}

function toMinimalYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${pad}${key}: null`);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
        continue;
      }
      lines.push(`${pad}${key}:`);
      for (const item of value) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const objLines = toMinimalYaml(item, indent + 4).split('\n');
          lines.push(`${pad}  - ${objLines[0].trimStart()}`);
          for (const extra of objLines.slice(1)) {
            if (extra.trim()) lines.push(extra);
          }
        } else {
          lines.push(`${pad}  - ${formatYamlScalar(item)}`);
        }
      }
      continue;
    }
    if (value !== null && typeof value === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(toMinimalYaml(value, indent + 2));
      continue;
    }
    lines.push(`${pad}${key}: ${formatYamlScalar(value)}`);
  }
  return lines.join('\n');
}

function formatYamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const str = String(value);
  if (str === '' || /[:\n#-]|^[\d-]/.test(str) || str.includes('"')) {
    return JSON.stringify(str);
  }
  return str;
}

function previewText(text, limit = 800) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3)}...`;
}
