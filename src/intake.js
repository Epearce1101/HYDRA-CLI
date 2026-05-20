import { readProjectConfig } from './project.js';
import { findHeadsByRole } from './heads.js';
import { colorize, systemLine } from './logo.js';
import { headDisplayColor } from './head-display.js';
import { RISK_LEVELS, APPROVAL_POLICIES } from './artifact-schemas.js';

export function findOracleHead() {
  return findHeadsByRole('oracle').find((head) => head.callable) || null;
}

export function suggestWorkerRoleFromBrief(brief, config = readProjectConfig()) {
  const text = `${brief?.goal || ''} ${(brief?.acceptance_criteria || []).join(' ')}`.toLowerCase();
  const candidates = Array.isArray(config?.orchestration?.worker_roles) ? config.orchestration.worker_roles : [];
  const matchers = [
    { role: 'debug', pattern: /\b(bug|crash|stack ?trace|exception|repro|failing test|broken)\b/ },
    { role: 'test', pattern: /\b(tests?|coverage|spec|fixture|jest|vitest|mocha|pytest)\b/ },
    { role: 'review', pattern: /\b(review|audit|quality|maintainability|cleanup|refactor checklist)\b/ },
    { role: 'architect', pattern: /\b(design|architecture|module boundary|api contract|interface|tradeoff)\b/ },
    { role: 'research', pattern: /\b(research|compare libraries|investigate|options for|benchmark)\b/ },
    { role: 'verify', pattern: /\b(verify|evidence|confirm|audit claim)\b/ },
    { role: 'code', pattern: /\b(implement|build|add|fix|refactor|migrate|extract|wire|hook up)\b/ },
  ];
  for (const matcher of matchers) {
    if (candidates.includes(matcher.role) && matcher.pattern.test(text)) {
      return matcher.role;
    }
  }
  return candidates.includes('code') ? 'code' : (candidates[0] || 'code');
}

export function buildIntakePrompt(userPrompt) {
  return `You are the ORACLE for a multi-head workflow. The user has given you the task below. Produce a Task Brief that captures what the work actually is, before any worker heads run.

USER PROMPT:
${userPrompt}

Reply with EXACTLY one JSON object and nothing else outside it (a short leading/trailing paragraph is fine, but the JSON block must be parseable on its own):

\`\`\`json
{
  "goal": "<one clear sentence stating what success looks like>",
  "non_goals": ["<things explicitly out of scope; empty list if none>"],
  "acceptance_criteria": ["<testable conditions; at least one>"],
  "risk_level": "low" | "medium" | "high" | "critical",
  "approval_policy": "auto" | "recommend" | "user_approval" | "user_approval_for_risk",
  "constraints": ["<technical/time/compliance/compatibility constraints; empty list if none>"],
  "assumptions": ["<things you are assuming; empty list if none>"],
  "repo_area": ["<paths or modules likely affected; empty list if unknown>"],
  "suggested_worker_role": "code" | "debug" | "test" | "review" | "architect" | "research" | "verify",
  "needs_spec": false,
  "reasoning": "<2-3 sentence rationale for the risk + policy + worker choice>"
}
\`\`\`

Guidance:
- Use "critical" only when failure has irreversible or external blast radius (data loss, security breach, customer-visible outage).
- Use "high" for security, auth, payments, migrations, anything touching production secrets, or destructive changes.
- Use "medium" by default for typical product features and refactors.
- Use "low" for trivial bug fixes, doc updates, or local-only changes.
- Default approval_policy to "recommend" unless the task is high/critical risk (then "user_approval_for_risk") or fully trivial (then "auto").
- Set "needs_spec": true only when the acceptance criteria are vague or there are multiple plausible interpretations.
- Choose suggested_worker_role from one of the configured worker roles when possible.`;
}

export function parseIntakeResponse(text) {
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
      const risk = RISK_LEVELS.includes(parsed.risk_level) ? parsed.risk_level : 'medium';
      const policy = APPROVAL_POLICIES.includes(parsed.approval_policy) ? parsed.approval_policy : 'recommend';
      return {
        ok: true,
        goal: typeof parsed.goal === 'string' && parsed.goal.trim() ? parsed.goal.trim() : '',
        non_goals: Array.isArray(parsed.non_goals) ? parsed.non_goals.map(String).filter(Boolean) : [],
        acceptance_criteria: Array.isArray(parsed.acceptance_criteria) ? parsed.acceptance_criteria.map(String).filter(Boolean) : [],
        risk_level: risk,
        approval_policy: policy,
        constraints: Array.isArray(parsed.constraints) ? parsed.constraints.map(String).filter(Boolean) : [],
        assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.map(String).filter(Boolean) : [],
        repo_area: Array.isArray(parsed.repo_area) ? parsed.repo_area.map(String).filter(Boolean) : [],
        suggested_worker_role: typeof parsed.suggested_worker_role === 'string' ? parsed.suggested_worker_role.toLowerCase() : null,
        needs_spec: Boolean(parsed.needs_spec),
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        raw,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    ok: false,
    goal: '',
    non_goals: [],
    acceptance_criteria: [],
    risk_level: 'medium',
    approval_policy: 'recommend',
    constraints: [],
    assumptions: [],
    repo_area: [],
    suggested_worker_role: null,
    needs_spec: false,
    reasoning: 'Intake output was not parseable; fell back to defaults.',
    raw,
  };
}

export function heuristicBriefFromPrompt(userPrompt) {
  const text = String(userPrompt || '').trim();
  const firstSentence = text.split(/[.!?\n]/)[0] || text;
  const lower = text.toLowerCase();
  let risk = 'medium';
  if (/\b(critical|prod outage|leak|data loss|breach|payment|key|secret)\b/.test(lower)) risk = 'high';
  if (/\b(typo|doc|comment|readme|spelling)\b/.test(lower)) risk = 'low';
  return {
    ok: true,
    goal: firstSentence || text || '(no goal stated)',
    non_goals: [],
    acceptance_criteria: ['User accepts the change after review'],
    risk_level: risk,
    approval_policy: risk === 'high' || risk === 'critical' ? 'user_approval_for_risk' : 'recommend',
    constraints: [],
    assumptions: [],
    repo_area: [],
    suggested_worker_role: null,
    needs_spec: false,
    reasoning: 'Heuristic brief — no oracle head was callable.',
    raw: '',
  };
}

export function printTaskBriefSummary({ brief, oracleHead, taskId }) {
  const oracleColor = oracleHead ? headDisplayColor(oracleHead) : 'cyan';
  console.log('');
  console.log(`${colorize(`[ORACLE${oracleHead ? ` · ${oracleHead.name}` : ''}]`, oracleColor)} task ${taskId} · draft Task Brief`);
  console.log('');
  console.log(`Goal:            ${brief.goal || '(none)'}`);
  console.log(`Risk:            ${brief.risk_level}`);
  console.log(`Approval policy: ${brief.approval_policy}`);
  if (brief.suggested_worker_role) {
    console.log(`Suggested role:  ${brief.suggested_worker_role}`);
  }
  if (brief.non_goals.length) {
    console.log('Non-goals:');
    brief.non_goals.forEach((item) => console.log(`  - ${item}`));
  }
  if (brief.acceptance_criteria.length) {
    console.log('Acceptance criteria:');
    brief.acceptance_criteria.forEach((item) => console.log(`  - ${item}`));
  }
  if (brief.constraints.length) {
    console.log('Constraints:');
    brief.constraints.forEach((item) => console.log(`  - ${item}`));
  }
  if (brief.assumptions.length) {
    console.log('Assumptions:');
    brief.assumptions.forEach((item) => console.log(`  - ${item}`));
  }
  if (brief.repo_area.length) {
    console.log(`Repo area:       ${brief.repo_area.join(', ')}`);
  }
  if (brief.reasoning) {
    console.log('');
    console.log(`Reasoning:       ${brief.reasoning}`);
  }
  if (!brief.ok) {
    console.log(systemLine('Brief was synthesized from defaults — oracle could not produce structured output.', 'yellow'));
  }
}

export async function presentBriefForApproval({ brief, ask }) {
  console.log('');
  console.log('[A]ccept and continue   [E]dit (re-prompt oracle)   [R]isk override   [P]policy override   [X] cancel');
  const choice = (await ask('Choice: ')).trim().toUpperCase();
  if (!choice || choice === 'A' || choice === 'ACCEPT') {
    return { action: 'accept', brief };
  }
  if (choice === 'E' || choice === 'EDIT') {
    const note = (await ask('Edit note for oracle: ')).trim();
    return { action: 'edit', note, brief };
  }
  if (choice === 'R' || choice === 'RISK') {
    const next = (await ask(`Risk level [${RISK_LEVELS.join('|')}]: `)).trim().toLowerCase();
    if (RISK_LEVELS.includes(next)) {
      return { action: 'accept', brief: { ...brief, risk_level: next } };
    }
    console.log(systemLine(`Invalid risk "${next}". Brief unchanged.`, 'yellow'));
    return { action: 'accept', brief };
  }
  if (choice === 'P' || choice === 'POLICY') {
    const next = (await ask(`Approval policy [${APPROVAL_POLICIES.join('|')}]: `)).trim().toLowerCase();
    if (APPROVAL_POLICIES.includes(next)) {
      return { action: 'accept', brief: { ...brief, approval_policy: next } };
    }
    console.log(systemLine(`Invalid policy "${next}". Brief unchanged.`, 'yellow'));
    return { action: 'accept', brief };
  }
  if (choice === 'X' || choice === 'CANCEL') {
    return { action: 'cancel', brief };
  }
  console.log(systemLine(`Unrecognized choice "${choice}". Cancelled.`, 'yellow'));
  return { action: 'cancel', brief };
}
