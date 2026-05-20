import { findHeadsByRole } from './heads.js';
import { isValidSharedFileRule } from './artifact-schemas.js';

export function findArchitectHeads() {
  return findHeadsByRole('architect').filter((head) => head.callable);
}

export function buildArchitectPrompt({ brief, userPrompt }) {
  const briefSummary = [
    `GOAL: ${brief?.goal || userPrompt}`,
    brief?.non_goals?.length ? `NON_GOALS:\n${brief.non_goals.map((item) => `- ${item}`).join('\n')}` : '',
    brief?.acceptance_criteria?.length ? `ACCEPTANCE_CRITERIA:\n${brief.acceptance_criteria.map((item) => `- ${item}`).join('\n')}` : '',
    brief?.constraints?.length ? `CONSTRAINTS:\n${brief.constraints.map((item) => `- ${item}`).join('\n')}` : '',
    brief?.assumptions?.length ? `ASSUMPTIONS:\n${brief.assumptions.map((item) => `- ${item}`).join('\n')}` : '',
    brief?.repo_area?.length ? `REPO_AREA: ${brief.repo_area.join(', ')}` : '',
    brief?.risk_level ? `RISK_LEVEL: ${brief.risk_level}` : '',
  ].filter(Boolean).join('\n\n');

  return `You are the ARCHITECT for a multi-head workflow. Produce the Architecture Contract for the task below.

TASK BRIEF:
${briefSummary}

USER PROMPT:
${userPrompt}

Reply with EXACTLY one JSON object and nothing else outside it (short prose before/after is OK; the JSON block must be parseable on its own):

\`\`\`json
{
  "components_changed": ["<modules or paths that will be touched>"],
  "boundaries": ["<what stays separate; what must not change>"],
  "interfaces": {
    "unchanged": false,
    "new": ["<new APIs/contracts; empty array if none>"],
    "changed": ["<changed APIs/contracts; empty array if none>"]
  },
  "invariants": ["<conditions that must remain true; empty if none stated>"],
  "ownership_suggestions": ["<track:role:path-glob hints for parallel build; empty if none>"],
  "failure_modes": ["<what can break, runtime risks, integration risks>"],
  "test_strategy": "<one short paragraph describing how this will be tested>",
  "security_ops_considerations": ["<security or ops concerns; empty if none>"],
  "tradeoffs": {
    "chosen": "<short label for the chosen approach>",
    "alternatives": ["<other approaches considered>"],
    "why_rejected": ["<why each alternative was rejected>"]
  },
  "deferred_decisions": ["<decisions explicitly punted to later; empty if none>"],
  "notes": "<2-3 sentence summary of why this design fits the brief>"
}
\`\`\`

Guidance:
- Set "interfaces.unchanged": true (and empty new/changed) only when no external interfaces shift.
- Prefer SMALL boundaries: don't redesign the world; map the contract to the acceptance criteria.
- ownership_suggestions should look like "track-api: code: src/api/**" — paths use globs.
- If the brief is too vague to design against, set "deferred_decisions" to call that out instead of inventing scope.`;
}

export function parseArchitectResponse(text) {
  const raw = String(text || '');
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fencedMatch) candidates.push(fencedMatch[1]);
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const interfaces = normalizeInterfaces(parsed.interfaces);
      return {
        ok: true,
        components_changed: ensureStringArray(parsed.components_changed),
        boundaries: ensureStringArray(parsed.boundaries),
        interfaces,
        invariants: ensureStringArray(parsed.invariants),
        ownership_suggestions: ensureStringArray(parsed.ownership_suggestions),
        failure_modes: ensureStringArray(parsed.failure_modes),
        test_strategy: typeof parsed.test_strategy === 'string' ? parsed.test_strategy : '',
        security_ops_considerations: ensureStringArray(parsed.security_ops_considerations),
        tradeoffs: {
          chosen: typeof parsed.tradeoffs?.chosen === 'string' ? parsed.tradeoffs.chosen : '',
          alternatives: ensureStringArray(parsed.tradeoffs?.alternatives),
          why_rejected: ensureStringArray(parsed.tradeoffs?.why_rejected),
        },
        deferred_decisions: ensureStringArray(parsed.deferred_decisions),
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        raw,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    ok: false,
    components_changed: [],
    boundaries: [],
    interfaces: { unchanged: true, new: [], changed: [] },
    invariants: [],
    ownership_suggestions: [],
    failure_modes: ['architect_output_unparseable'],
    test_strategy: 'Architect output was not parseable; treat this contract as a stub and revise before build.',
    security_ops_considerations: [],
    tradeoffs: { chosen: '', alternatives: [], why_rejected: [] },
    deferred_decisions: ['Architect did not return parseable JSON'],
    notes: 'Fell back to default contract.',
    raw,
  };
}

export function buildArchitectJudgePrompt({ brief, userPrompt, contracts }) {
  const briefSummary = brief?.goal ? `GOAL: ${brief.goal}` : `USER PROMPT: ${userPrompt}`;
  const labelled = contracts.map((contract, index) => {
    const letter = String.fromCharCode(65 + index);
    const summary = JSON.stringify({
      components_changed: contract.parsed.components_changed,
      boundaries: contract.parsed.boundaries,
      interfaces: contract.parsed.interfaces,
      tradeoffs_chosen: contract.parsed.tradeoffs.chosen,
      notes: contract.parsed.notes,
    }, null, 2);
    return `## Contract ${letter} — head: ${contract.head}\n${summary}`;
  }).join('\n\n---\n\n');
  return `You are the JUDGE at architecture checkpoint A. ${contracts.length} architects produced competing Architecture Contracts for the same task.

${briefSummary}

CANDIDATE CONTRACTS:
${labelled}

Reply with EXACTLY one JSON object and nothing else outside it:

\`\`\`json
{
  "action": "pick" | "merge_components" | "ask_user",
  "selected_option": "A" | "B" | "C" | null,
  "merged_components": ["<components if merging>"],
  "confidence": "high" | "medium" | "low",
  "reasoning": "<2-4 sentences referencing concrete fields from the contracts>",
  "risks": ["<short risk strings or empty>"]
}
\`\`\`

Guidance:
- Prefer "pick" when one contract is materially cleaner or more aligned with the brief.
- Use "merge_components" only when the contracts cover different parts of the system that can be combined without contradiction.
- Use "ask_user" when the choice is a subjective product tradeoff or when both contracts have unresolved gaps.`;
}

export function parseArchitectJudgeResponse(text) {
  const raw = String(text || '');
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fencedMatch) candidates.push(fencedMatch[1]);
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }
  const validActions = ['pick', 'merge_components', 'ask_user'];
  const validConfidence = ['high', 'medium', 'low'];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return {
        ok: true,
        action: validActions.includes(parsed.action) ? parsed.action : 'ask_user',
        selected_option: typeof parsed.selected_option === 'string' ? parsed.selected_option.toUpperCase() : null,
        merged_components: ensureStringArray(parsed.merged_components),
        confidence: validConfidence.includes(parsed.confidence) ? parsed.confidence : 'low',
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        risks: ensureStringArray(parsed.risks),
        raw,
      };
    } catch {
      // try next candidate
    }
  }
  return {
    ok: false,
    action: 'ask_user',
    selected_option: null,
    merged_components: [],
    confidence: 'low',
    reasoning: 'Architect judge output was not parseable.',
    risks: ['judge_output_unparseable'],
    raw,
  };
}

export function formatArchitectureContractForWorker(parsed) {
  const lines = [];
  lines.push('ARCHITECTURE CONTRACT (must be followed):');
  lines.push(`- Components: ${parsed.components_changed.join(', ') || '(none stated)'}`);
  if (parsed.boundaries.length) lines.push(`- Boundaries: ${parsed.boundaries.join('; ')}`);
  if (parsed.interfaces?.unchanged) {
    lines.push('- Interfaces: unchanged.');
  } else {
    if (Array.isArray(parsed.interfaces?.new) && parsed.interfaces.new.length) {
      lines.push(`- New interfaces: ${parsed.interfaces.new.join('; ')}`);
    }
    if (Array.isArray(parsed.interfaces?.changed) && parsed.interfaces.changed.length) {
      lines.push(`- Changed interfaces: ${parsed.interfaces.changed.join('; ')}`);
    }
  }
  if (parsed.invariants.length) lines.push(`- Invariants: ${parsed.invariants.join('; ')}`);
  if (parsed.failure_modes.length) lines.push(`- Watch failure modes: ${parsed.failure_modes.join('; ')}`);
  if (parsed.test_strategy) lines.push(`- Test strategy: ${parsed.test_strategy}`);
  if (parsed.deferred_decisions.length) lines.push(`- Deferred (do NOT decide these here): ${parsed.deferred_decisions.join('; ')}`);
  return lines.join('\n');
}

function ensureStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter((entry) => entry.trim());
}

const TRACK_LINE_RE = /^\s*([A-Za-z0-9_-]+)\s*[:|]\s*([A-Za-z0-9_-]+)\s*[:|]\s*(.+)\s*$/;

export function parseOwnershipSuggestions(suggestions, { defaultRole = 'code' } = {}) {
  const tracks = [];
  const sharedFiles = [];
  const crossCutting = [];
  const usedIds = new Set();
  const list = Array.isArray(suggestions) ? suggestions : [];
  let fallbackCounter = 0;
  for (const raw of list) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const match = line.match(TRACK_LINE_RE);
    if (match) {
      const trackId = uniqueTrackId(match[1].trim(), usedIds);
      const ownerRole = match[2].trim();
      const pathChunk = match[3].trim();
      const paths = pathChunk.split(/[,\s;]+/).map((value) => value.trim()).filter(Boolean);
      tracks.push({
        track_id: trackId,
        owner_role: ownerRole,
        owner_head: null,
        paths,
        shared_allowed: false,
        dependencies: [],
      });
      continue;
    }
    if (/^shared\b|^shared_file\b/i.test(line)) {
      const inner = line.replace(/^shared(_file)?\s*:?\s*/i, '');
      const segments = inner.split(/[:|]/).map((segment) => segment.trim());
      const path = segments[0] || '';
      const rule = isValidSharedFileRule(segments[1]) ? segments[1] : 'oracle_only_merge';
      if (path) {
        sharedFiles.push({
          path,
          rule,
          allowed_changes: segments.slice(2).filter(Boolean),
          expires_phase: 'integration_check',
        });
      }
      continue;
    }
    if (/^cross[- ]?cut/i.test(line)) {
      crossCutting.push(line.replace(/^cross[- ]?cut(ting)?\s*:?\s*/i, ''));
      continue;
    }
    // Fallback: treat the whole line as a path glob and synthesize a track.
    fallbackCounter += 1;
    const trackId = uniqueTrackId(`track-${fallbackCounter}`, usedIds);
    tracks.push({
      track_id: trackId,
      owner_role: defaultRole,
      owner_head: null,
      paths: line.split(/[,\s;]+/).map((value) => value.trim()).filter(Boolean),
      shared_allowed: false,
      dependencies: [],
    });
  }
  return { tracks, shared_files: sharedFiles, cross_cutting_changes: crossCutting };
}

function uniqueTrackId(base, usedIds) {
  let candidate = base || 'track';
  let n = 1;
  while (usedIds.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  usedIds.add(candidate);
  return candidate;
}

export function buildDefaultOwnershipMap({ defaultRole = 'code', components = [] } = {}) {
  const paths = Array.isArray(components) && components.length
    ? components.map((entry) => normalizePathGlob(entry))
    : ['src/**'];
  return {
    tracks: [
      {
        track_id: 'track-default',
        owner_role: defaultRole,
        owner_head: null,
        paths: paths.filter((entry) => entry && entry !== '**' && entry !== '*'),
        shared_allowed: false,
        dependencies: [],
      },
    ],
    shared_files: [],
    cross_cutting_changes: [],
  };
}

function normalizePathGlob(entry) {
  const value = String(entry || '').trim();
  if (!value) return '';
  if (value.endsWith('/**') || value.includes('*')) return value;
  if (value.endsWith('/')) return `${value}**`;
  if (/\.[a-zA-Z0-9]+$/.test(value)) return value;
  return `${value.replace(/\/$/, '')}/**`;
}

export function globToRegExp(pattern) {
  const value = String(pattern || '').replace(/\\/g, '/');
  let re = '^';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '*') {
      if (value[i + 1] === '*') {
        re += '.*';
        i += 1;
        if (value[i + 1] === '/') i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('.+^$()|{}[]'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

export function pathMatchesAny(path, globs) {
  const normalized = String(path || '').replace(/\\/g, '/');
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

export function validatePathsAgainstMap(paths, map, { writes = true } = {}) {
  const violations = [];
  const okPaths = [];
  const sharedFiles = Array.isArray(map?.shared_files) ? map.shared_files : [];
  const tracks = Array.isArray(map?.tracks) ? map.tracks : [];
  for (const path of paths || []) {
    const normalized = String(path || '').replace(/\\/g, '/');
    if (!normalized) continue;
    const sharedMatch = sharedFiles.find((shared) => globToRegExp(shared.path).test(normalized) || shared.path === normalized);
    if (sharedMatch) {
      if (sharedMatch.rule === 'read_only' && writes) {
        violations.push({ path: normalized, kind: 'shared_read_only_violation', shared: sharedMatch });
        continue;
      }
      okPaths.push({ path: normalized, kind: 'shared', shared: sharedMatch });
      continue;
    }
    const trackMatch = tracks.find((track) => pathMatchesAny(normalized, track.paths || []));
    if (trackMatch) {
      okPaths.push({ path: normalized, kind: 'track', track: trackMatch });
      continue;
    }
    violations.push({ path: normalized, kind: 'unowned' });
  }
  return { ok: violations.length === 0, violations, owned: okPaths };
}

export function formatOwnershipMapForWorker(map, { headRole = null } = {}) {
  if (!map || !Array.isArray(map.tracks) || map.tracks.length === 0) return '';
  const lines = ['OWNERSHIP MAP (you must only edit files within your own track):'];
  for (const track of map.tracks) {
    const marker = headRole && track.owner_role === headRole ? ' (YOUR TRACK)' : '';
    lines.push(`- ${track.track_id} [${track.owner_role}]${marker}: ${track.paths.join(', ')}`);
  }
  if (Array.isArray(map.shared_files) && map.shared_files.length) {
    lines.push('Shared files (use only per rule):');
    for (const shared of map.shared_files) {
      const allowed = Array.isArray(shared.allowed_changes) && shared.allowed_changes.length ? ` allowed: ${shared.allowed_changes.join(', ')}` : '';
      lines.push(`- ${shared.path} [${shared.rule}]${allowed}`);
    }
  }
  if (Array.isArray(map.cross_cutting_changes) && map.cross_cutting_changes.length) {
    lines.push('Cross-cutting changes (declared):');
    for (const entry of map.cross_cutting_changes) {
      lines.push(`- ${entry}`);
    }
  }
  return lines.join('\n');
}

function normalizeInterfaces(value) {
  if (value === null || value === undefined) return { unchanged: true, new: [], changed: [] };
  if (typeof value !== 'object') return { unchanged: true, new: [], changed: [] };
  const unchanged = Boolean(value.unchanged);
  const newOnes = ensureStringArray(value.new);
  const changed = ensureStringArray(value.changed);
  if (!unchanged && newOnes.length === 0 && changed.length === 0) {
    return { unchanged: true, new: [], changed: [] };
  }
  return { unchanged, new: newOnes, changed };
}
