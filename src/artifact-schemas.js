export const ARTIFACT_IDS = Object.freeze([
  'task_brief',
  'spec_clarification',
  'architecture_contract',
  'ownership_map',
  'implementation_notes',
  'test_coverage_map',
  'threat_model_lite',
  'devops_impact',
  'review_findings',
  'decision_log',
  'evidence_audit',
  'gate_summary',
  'runbook_rollout',
  'lineage_log',
]);

export const ARTIFACT_STATUSES = Object.freeze([
  'draft',
  'ready',
  'blocked',
  'superseded',
  'rejected',
  'accepted',
]);

export const KNOWN_PHASES = Object.freeze([
  'intake',
  'spec_check',
  'pre_research',
  'architecture_gate',
  'judge_checkpoint_a',
  'ownership_gate',
  'parallel_build',
  'integration_check',
  'judge_checkpoint_b',
  'validation',
  'validation_triage',
  'advisor_pass',
  'judge_verify_checkpoint_c',
  'packaging',
  'user_result',
  'closed',
]);

export const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);

export const APPROVAL_POLICIES = Object.freeze([
  'auto',
  'recommend',
  'user_approval',
  'user_approval_for_risk',
]);

export const SECURITY_SEVERITIES = Object.freeze(['clear', 'low', 'medium', 'high', 'critical']);

export const EVIDENCE_LABELS = Object.freeze([
  'verified_runnable',
  'verified_static',
  'unverified',
  'contradicted',
]);

export const JUDGE_CHECKPOINTS = Object.freeze([
  'A',
  'B',
  'C',
  'validation_triage',
  'user_rejection',
]);

export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

export const IMPLEMENTATION_CHANGE_TYPES = Object.freeze(['add', 'edit', 'delete']);

export const SHARED_FILE_RULES = Object.freeze([
  'oracle_only_merge',
  'no_touch_without_judge',
  'append_only',
  'read_only',
]);

export const SHARED_FILE_RULE_PREFIXES = Object.freeze([
  'single_delegate:',
  'timeboxed_window:',
]);

export function isValidSharedFileRule(rule) {
  if (typeof rule !== 'string' || !rule.trim()) return false;
  if (SHARED_FILE_RULES.includes(rule)) return true;
  return SHARED_FILE_RULE_PREFIXES.some((prefix) => rule.startsWith(prefix) && rule.length > prefix.length);
}

function fail(errors, message) {
  errors.push(message);
}

function validateMetadata(metadata, errors, { checkLifecycleStatus = true } = {}) {
  if (!metadata || typeof metadata !== 'object') {
    fail(errors, 'metadata: missing or not an object');
    return;
  }
  if (typeof metadata.task_id !== 'string' || !metadata.task_id.trim()) {
    fail(errors, 'metadata.task_id: required string');
  }
  if (!ARTIFACT_IDS.includes(metadata.artifact)) {
    fail(errors, `metadata.artifact: must be one of ${ARTIFACT_IDS.join(', ')}`);
  }
  if (typeof metadata.owner_role !== 'string' || !metadata.owner_role.trim()) {
    fail(errors, 'metadata.owner_role: required string (role tag or "user")');
  }
  if (!Number.isInteger(metadata.version) || metadata.version < 1) {
    fail(errors, 'metadata.version: required positive integer');
  }
  if (checkLifecycleStatus && !ARTIFACT_STATUSES.includes(metadata.status)) {
    fail(errors, `metadata.status: must be one of ${ARTIFACT_STATUSES.join(', ')}`);
  }
  if (metadata.produced_in_phase !== undefined && metadata.produced_in_phase !== null
    && !KNOWN_PHASES.includes(metadata.produced_in_phase)) {
    fail(errors, `metadata.produced_in_phase: must be null or one of ${KNOWN_PHASES.join(', ')}`);
  }
  if (metadata.consumed_by_phase !== undefined && metadata.consumed_by_phase !== null
    && !KNOWN_PHASES.includes(metadata.consumed_by_phase)) {
    fail(errors, `metadata.consumed_by_phase: must be null or one of ${KNOWN_PHASES.join(', ')}`);
  }
}

export function validateDecisionLog(artifact) {
  const errors = [];
  validateMetadata(artifact, errors);
  if (artifact?.artifact !== 'decision_log') {
    fail(errors, 'artifact: must be decision_log');
  }
  if (!JUDGE_CHECKPOINTS.includes(artifact?.checkpoint)) {
    fail(errors, `checkpoint: must be one of ${JUDGE_CHECKPOINTS.join(', ')}`);
  }
  if (!CONFIDENCE_LEVELS.includes(artifact?.confidence_level)) {
    fail(errors, `confidence_level: must be one of ${CONFIDENCE_LEVELS.join(', ')}`);
  }
  if (!Array.isArray(artifact?.options_evaluated) || artifact.options_evaluated.length === 0) {
    fail(errors, 'options_evaluated: required non-empty array');
  }
  if (artifact?.selected === undefined || artifact?.selected === null) {
    fail(errors, 'selected: required (use empty string when deferring to user)');
  }
  if (typeof artifact?.requires_user_approval !== 'boolean') {
    fail(errors, 'requires_user_approval: required boolean');
  }
  if (artifact?.risk_level && !RISK_LEVELS.includes(artifact.risk_level)) {
    fail(errors, `risk_level: must be one of ${RISK_LEVELS.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateGateSummary(artifact) {
  const errors = [];
  // Gate summary overloads `status` to mean the gate outcome (pass/fail/blocked),
  // not the artifact lifecycle, so we skip the lifecycle-status check in metadata.
  validateMetadata(artifact, errors, { checkLifecycleStatus: false });
  if (artifact?.artifact !== 'gate_summary') {
    fail(errors, 'artifact: must be gate_summary');
  }
  if (typeof artifact?.gate !== 'string' || !artifact.gate.trim()) {
    fail(errors, 'gate: required string');
  }
  if (!['pass', 'fail', 'blocked'].includes(artifact?.status)) {
    fail(errors, 'status: must be one of pass, fail, blocked');
  }
  if (!Array.isArray(artifact?.updated_artifacts)) {
    fail(errors, 'updated_artifacts: required array (empty is fine)');
  }
  if (!Array.isArray(artifact?.blockers)) {
    fail(errors, 'blockers: required array (empty is fine)');
  }
  if (typeof artifact?.judge_checkpoint_required !== 'boolean') {
    fail(errors, 'judge_checkpoint_required: required boolean');
  }
  if (!Number.isInteger(artifact?.backtracks_used_in_phase) || artifact.backtracks_used_in_phase < 0) {
    fail(errors, 'backtracks_used_in_phase: required non-negative integer');
  }
  return { ok: errors.length === 0, errors };
}

export function validateOwnershipMap(artifact) {
  const errors = [];
  validateMetadata(artifact, errors);
  if (artifact?.artifact !== 'ownership_map') {
    fail(errors, 'artifact: must be ownership_map');
  }
  if (!Array.isArray(artifact?.tracks) || artifact.tracks.length === 0) {
    fail(errors, 'tracks: required non-empty array');
  } else {
    const seenIds = new Set();
    artifact.tracks.forEach((track, index) => {
      const label = `tracks[${index}]`;
      if (!track || typeof track !== 'object') {
        fail(errors, `${label}: must be an object`);
        return;
      }
      if (typeof track.track_id !== 'string' || !track.track_id.trim()) {
        fail(errors, `${label}.track_id: required string`);
      } else if (seenIds.has(track.track_id)) {
        fail(errors, `${label}.track_id: duplicate "${track.track_id}"`);
      } else {
        seenIds.add(track.track_id);
      }
      if (typeof track.owner_role !== 'string' || !track.owner_role.trim()) {
        fail(errors, `${label}.owner_role: required string`);
      }
      if (!Array.isArray(track.paths) || track.paths.length === 0) {
        fail(errors, `${label}.paths: required non-empty array (no track may have unlimited ownership)`);
      } else {
        const overlyBroad = track.paths.some((path) => typeof path !== 'string' || path === '**' || path === '**/*' || path === '*');
        if (overlyBroad) {
          fail(errors, `${label}.paths: contains an unlimited glob (** / * are not allowed; scope to a subtree)`);
        }
      }
      if (!Array.isArray(track.dependencies)) {
        fail(errors, `${label}.dependencies: required array (empty is fine)`);
      }
    });
  }
  if (!Array.isArray(artifact?.shared_files)) {
    fail(errors, 'shared_files: required array (empty is fine)');
  } else {
    artifact.shared_files.forEach((shared, index) => {
      const label = `shared_files[${index}]`;
      if (!shared || typeof shared !== 'object') {
        fail(errors, `${label}: must be an object`);
        return;
      }
      if (typeof shared.path !== 'string' || !shared.path.trim()) {
        fail(errors, `${label}.path: required string`);
      }
      if (!isValidSharedFileRule(shared.rule)) {
        fail(errors, `${label}.rule: must be one of [${SHARED_FILE_RULES.join(', ')}] or a prefix [${SHARED_FILE_RULE_PREFIXES.join(', ')}<value>`);
      }
      if (!Array.isArray(shared.allowed_changes)) {
        fail(errors, `${label}.allowed_changes: required array (empty is fine)`);
      }
    });
  }
  if (!Array.isArray(artifact?.cross_cutting_changes)) {
    fail(errors, 'cross_cutting_changes: required array (empty is fine; must be explicit)');
  }
  return { ok: errors.length === 0, errors };
}

export function validateImplementationNotes(artifact, { ownershipMap = null } = {}) {
  const errors = [];
  validateMetadata(artifact, errors);
  if (artifact?.artifact !== 'implementation_notes') {
    fail(errors, 'artifact: must be implementation_notes');
  }
  if (typeof artifact?.track_id !== 'string' || !artifact.track_id.trim()) {
    fail(errors, 'track_id: required non-empty string');
  } else if (ownershipMap && Array.isArray(ownershipMap.tracks) && ownershipMap.tracks.length) {
    const hasTrack = ownershipMap.tracks.some((track) => track?.track_id === artifact.track_id);
    if (!hasTrack) {
      fail(errors, `track_id: "${artifact.track_id}" is not present in ownership_map.tracks`);
    }
  }
  if (!Array.isArray(artifact?.files_changed) || artifact.files_changed.length === 0) {
    fail(errors, 'files_changed: required non-empty array');
  } else {
    artifact.files_changed.forEach((file, index) => {
      const label = `files_changed[${index}]`;
      if (!file || typeof file !== 'object') {
        fail(errors, `${label}: must be an object`);
        return;
      }
      if (typeof file.path !== 'string' || !file.path.trim()) {
        fail(errors, `${label}.path: required string`);
      }
      if (!IMPLEMENTATION_CHANGE_TYPES.includes(file.change)) {
        fail(errors, `${label}.change: must be one of ${IMPLEMENTATION_CHANGE_TYPES.join(', ')}`);
      }
      if (typeof file.reason !== 'string' || !file.reason.trim()) {
        fail(errors, `${label}.reason: required string`);
      }
    });
  }
  if (typeof artifact?.summary !== 'string' || !artifact.summary.trim()) {
    fail(errors, 'summary: required non-empty string');
  }
  if (!Array.isArray(artifact?.assumptions)) {
    fail(errors, 'assumptions: required array (empty is fine)');
  }
  if (typeof artifact?.rollback_notes !== 'string' || !artifact.rollback_notes.trim()) {
    fail(errors, 'rollback_notes: required non-empty string');
  }
  if (!Array.isArray(artifact?.verification_suggested) || artifact.verification_suggested.length === 0) {
    fail(errors, 'verification_suggested: required non-empty array');
  } else {
    artifact.verification_suggested.forEach((check, index) => {
      const label = `verification_suggested[${index}]`;
      if (!check || typeof check !== 'object') {
        fail(errors, `${label}: must be an object`);
        return;
      }
      if (typeof check.command !== 'string' || !check.command.trim()) {
        fail(errors, `${label}.command: required string`);
      }
      if (typeof check.expected !== 'string' || !check.expected.trim()) {
        fail(errors, `${label}.expected: required string`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

export function validateArchitectureContract(artifact) {
  const errors = [];
  validateMetadata(artifact, errors);
  if (artifact?.artifact !== 'architecture_contract') {
    fail(errors, 'artifact: must be architecture_contract');
  }
  if (!Array.isArray(artifact?.components_changed)) {
    fail(errors, 'components_changed: required array (empty is fine if explicit "no components changed" is in notes)');
  }
  if (artifact?.interfaces === undefined || artifact.interfaces === null) {
    fail(errors, 'interfaces: required (use {"unchanged": true} when no interfaces change)');
  } else if (typeof artifact.interfaces !== 'object') {
    fail(errors, 'interfaces: must be an object');
  } else if (!artifact.interfaces.unchanged && !Array.isArray(artifact.interfaces.new) && !Array.isArray(artifact.interfaces.changed)) {
    fail(errors, 'interfaces: must declare unchanged=true OR provide new[]/changed[] arrays');
  }
  if (!Array.isArray(artifact?.invariants)) {
    fail(errors, 'invariants: required array (empty is fine if explicit)');
  }
  if (!Array.isArray(artifact?.failure_modes)) {
    fail(errors, 'failure_modes: required array (empty is fine if explicit)');
  }
  if (typeof artifact?.test_strategy !== 'string' || !artifact.test_strategy.trim()) {
    fail(errors, 'test_strategy: required non-empty string');
  }
  if (!Array.isArray(artifact?.deferred_decisions)) {
    fail(errors, 'deferred_decisions: required array (empty is fine)');
  }
  return { ok: errors.length === 0, errors };
}

export function validateTaskBrief(artifact) {
  const errors = [];
  validateMetadata(artifact, errors);
  if (artifact?.artifact !== 'task_brief') {
    fail(errors, 'artifact: must be task_brief');
  }
  if (typeof artifact?.goal !== 'string' || !artifact.goal.trim()) {
    fail(errors, 'goal: required non-empty string');
  }
  if (!Array.isArray(artifact?.non_goals)) {
    fail(errors, 'non_goals: required array (empty is fine if explicit)');
  }
  if (!Array.isArray(artifact?.acceptance_criteria) || artifact.acceptance_criteria.length === 0) {
    fail(errors, 'acceptance_criteria: required non-empty array');
  }
  if (!RISK_LEVELS.includes(artifact?.risk_level)) {
    fail(errors, `risk_level: must be one of ${RISK_LEVELS.join(', ')}`);
  }
  if (!APPROVAL_POLICIES.includes(artifact?.approval_policy)) {
    fail(errors, `approval_policy: must be one of ${APPROVAL_POLICIES.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}

export function newMetadata({
  taskId,
  artifact,
  ownerRole,
  version = 1,
  status = 'draft',
  producedInPhase = null,
  consumedByPhase = null,
}) {
  const now = new Date().toISOString();
  return {
    task_id: taskId,
    artifact,
    owner_role: ownerRole,
    owner_head: null,
    version,
    status,
    produced_in_phase: producedInPhase,
    consumed_by_phase: consumedByPhase,
    inputs: [],
    decisions: [],
    assumptions: [],
    created_at: now,
    updated_at: now,
  };
}
