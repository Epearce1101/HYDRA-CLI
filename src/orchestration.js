import { readProjectConfig, writeTaskLog } from './project.js';
import { findHeadsByRole, detectConnectedHeads } from './heads.js';
import { newTaskId, ensureTaskState, appendLineage } from './artifacts.js';
import { colorize, systemLine } from './logo.js';
import { headDisplayColor } from './head-display.js';

export function isOrchestrationEnabled(config = readProjectConfig()) {
  return Boolean(config?.orchestration?.enabled);
}

export function isWorkerRole(roleTag, config = readProjectConfig()) {
  const list = Array.isArray(config?.orchestration?.worker_roles) ? config.orchestration.worker_roles : [];
  return list.map((r) => String(r || '').toLowerCase()).includes(String(roleTag || '').toLowerCase());
}

export function findJudgeHead(config = readProjectConfig()) {
  const tag = String(config?.orchestration?.judge_role || 'judge').toLowerCase();
  return findHeadsByRole(tag).find((head) => head.callable) || null;
}

export function findAdvisorHead(config = readProjectConfig()) {
  const tag = String(config?.orchestration?.advisor_role || 'advisor').toLowerCase();
  return findHeadsByRole(tag).find((head) => head.callable) || null;
}

export function findWorkerHeads(roleTag, config = readProjectConfig()) {
  const heads = findHeadsByRole(roleTag).filter((head) => head.callable);
  // Exclude the judge head from worker fan-out, even if it's also tagged with the worker role.
  const judgeTag = String(config?.orchestration?.judge_role || 'judge').toLowerCase();
  return heads.filter((head) => String(head.role || '').toLowerCase() !== judgeTag);
}

export function shouldOrchestrate(roleTag, config = readProjectConfig()) {
  if (!isOrchestrationEnabled(config)) return false;
  if (!isWorkerRole(roleTag, config)) return false;
  return findWorkerHeads(roleTag, config).length >= 2;
}

export function startOrchestration({ prompt, roleTag, config = readProjectConfig() }) {
  const taskId = newTaskId();
  ensureTaskState(taskId);
  appendLineage(taskId, {
    event: 'orchestration_started',
    role_tag: roleTag,
    decision_policy: config?.orchestration?.decision_policy || 'recommend',
    prompt_preview: String(prompt || '').slice(0, 200),
  });
  writeTaskLog({
    type: 'orchestration.started',
    task_id: taskId,
    role_tag: roleTag,
  });
  return taskId;
}

export function recordWorkerResponses(taskId, responses) {
  for (const response of responses) {
    appendLineage(taskId, {
      event: 'worker_response',
      head: response.head,
      ok: Boolean(response.ok),
      length: String(response.text || '').length,
    });
  }
}

export function buildJudgePrompt({ originalPrompt, responses, roleTag }) {
  const labelled = responses.map((response, index) => {
    const letter = String.fromCharCode(65 + index);
    return `## Option ${letter} — head: ${response.head}\n${response.text || '(empty)'}`;
  }).join('\n\n---\n\n');

  return `You are the JUDGE for a multi-head orchestration. ${responses.length} heads were tagged with the "${roleTag}" role and produced the responses below for the user prompt.

USER PROMPT:
${originalPrompt}

CANDIDATE RESPONSES:
${labelled}

Decide one of: pick the best single option, synthesize a unified response, or defer to the user. Reply with EXACTLY one JSON object and nothing else outside it (a leading/trailing prose paragraph is OK but the JSON block must be parseable on its own):

\`\`\`json
{
  "action": "pick" | "synthesize" | "ask_user",
  "selected_option": "A" | "B" | "C" | null,
  "confidence": "high" | "medium" | "low",
  "reasoning": "<2-4 sentence rationale referencing the options>",
  "synthesized": "<full unified answer when action is synthesize, otherwise null>",
  "user_question": "<short clarifying question when action is ask_user, otherwise null>",
  "risks": ["<short risk strings; empty list if none>"]
}
\`\`\`

Guidance:
- Use "pick" when one option is clearly better and "synthesize" would just be that option.
- Use "synthesize" when options have complementary strengths and a unified answer is materially better.
- Use "ask_user" when the choice depends on a subjective tradeoff or on information you do not have.
- Set "confidence" to "low" if any option has serious unresolved risk, contradicting claims, or you lack evidence.`;
}

export function parseJudgeResponse(text) {
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
      const action = ['pick', 'synthesize', 'ask_user'].includes(parsed.action) ? parsed.action : 'ask_user';
      const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low';
      return {
        ok: true,
        action,
        selected_option: typeof parsed.selected_option === 'string' ? parsed.selected_option.toUpperCase() : null,
        confidence,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        synthesized: typeof parsed.synthesized === 'string' ? parsed.synthesized : null,
        user_question: typeof parsed.user_question === 'string' ? parsed.user_question : null,
        risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
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
    confidence: 'low',
    reasoning: 'Judge output was not parseable JSON. Falling back to text summary.',
    synthesized: null,
    user_question: 'Judge response could not be parsed — pick a worker option manually?',
    risks: ['judge_output_unparseable'],
    raw,
  };
}

function formatRisks(risks) {
  if (!risks?.length) return '';
  return `\nRisks:\n${risks.map((risk) => `  - ${risk}`).join('\n')}`;
}

export function printJudgeRecommendation({ judge, responses, judgeHead, taskId }) {
  console.log('');
  const judgeColor = judgeHead ? headDisplayColor(judgeHead) : 'purple';
  console.log(`${colorize(`[JUDGE${judgeHead ? ` · ${judgeHead.name}` : ''}]`, judgeColor)} task ${taskId}`);
  console.log(`Action: ${judge.action}    Confidence: ${judge.confidence}`);
  if (judge.action === 'pick' && judge.selected_option) {
    const idx = judge.selected_option.charCodeAt(0) - 65;
    const picked = responses[idx];
    if (picked) {
      console.log(`Selected: Option ${judge.selected_option} (${picked.head})`);
    }
  }
  if (judge.reasoning) {
    console.log('');
    console.log('Reasoning:');
    console.log(judge.reasoning);
  }
  if (judge.action === 'synthesize' && judge.synthesized) {
    console.log('');
    console.log(colorize('--- Synthesized Answer ---', judgeColor));
    console.log(judge.synthesized);
  }
  if (judge.action === 'pick' && judge.selected_option) {
    const idx = judge.selected_option.charCodeAt(0) - 65;
    const picked = responses[idx];
    if (picked) {
      console.log('');
      console.log(colorize(`--- Selected Answer (${picked.head}) ---`, judgeColor));
      console.log(picked.text || '(empty)');
    }
  }
  if (judge.action === 'ask_user' && judge.user_question) {
    console.log('');
    console.log(colorize(`Judge defers to you: ${judge.user_question}`, 'yellow'));
  }
  if (judge.risks?.length) {
    console.log(formatRisks(judge.risks));
  }
}

export async function presentOrchestrationChoice({ judge, responses, ask, decisionPolicy = 'recommend' }) {
  const requiresApproval = decisionPolicy === 'user_approval' || decisionPolicy === 'user_approval_for_risk' || judge.confidence === 'low' || judge.action === 'ask_user';
  if (!requiresApproval) {
    return { action: 'auto_accepted' };
  }

  console.log('');
  console.log('[A]ccept judge   [O]ption N (e.g. OA, OB)   [M]anual decide   [X] cancel');
  const choice = (await ask('Choice: ')).trim().toUpperCase();
  if (!choice || choice === 'A' || choice === 'ACCEPT') {
    return { action: 'accept' };
  }
  if (choice.startsWith('O') && choice.length >= 2) {
    const letter = choice.slice(1);
    const idx = letter.charCodeAt(0) - 65;
    if (responses[idx]) {
      return { action: 'pick', head: responses[idx].head, text: responses[idx].text };
    }
  }
  if (choice === 'M' || choice === 'MANUAL') {
    return { action: 'manual' };
  }
  if (choice === 'X' || choice === 'CANCEL') {
    return { action: 'cancel' };
  }
  console.log(systemLine(`Unrecognized choice "${choice}". Cancelled.`, 'yellow'));
  return { action: 'cancel' };
}

export function describeRoleCoverage(config = readProjectConfig()) {
  const heads = detectConnectedHeads();
  const coverage = new Map();
  for (const head of heads) {
    const role = String(head.role || '').toLowerCase();
    if (!role) continue;
    if (!coverage.has(role)) coverage.set(role, []);
    coverage.get(role).push(head);
  }
  return {
    enabled: isOrchestrationEnabled(config),
    decision_policy: config?.orchestration?.decision_policy || 'recommend',
    worker_roles: config?.orchestration?.worker_roles || [],
    judge_role: config?.orchestration?.judge_role || 'judge',
    coverage,
  };
}
