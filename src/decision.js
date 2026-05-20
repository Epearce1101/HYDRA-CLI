import fs from 'node:fs';
import { sanitizeErrorMessage } from './adapters/base.js';
import { extractResponseTokens, recordBudgetUsage } from './budget.js';
import { append_entry, readHydraFile } from './hydra-file.js';
import { getHead } from './heads.js';
import { getProjectPaths, writeTaskLog } from './project.js';

let pendingDecision = null;
let lastParallelResponses = null;

// Decision prompt engine for Hydra CLI

export function scoreDifference(textA, textB) {
  return simpleDifferenceScore(textA, textB);
}

export function responsesAreDifferent(responses, threshold = 0.20) {
  const valid = normalizeResponses(responses).filter((response) => response.content.trim());
  if (valid.length < 2) {
    return false;
  }

  for (let leftIndex = 0; leftIndex < valid.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < valid.length; rightIndex += 1) {
      if (simpleDifferenceScore(valid[leftIndex].content, valid[rightIndex].content) > threshold) {
        return true;
      }
    }
  }

  return false;
}

export async function showDecisionPrompt(responses, prompt, rl, options = {}) {
  const decision = options.decision || ensurePendingDecision(prompt, responses);
  pendingDecision = decision;
  const normalized = decision.responses;

  if (normalized.length < 2) {
    return { action: 'none' };
  }

  printDecisionPrompt(normalized);
  const choice = (await question(rl, 'Choice: ')).trim().toUpperCase();
  return handleDecisionChoice(choice, decision, rl, options);
}

export async function handleMerge(selectedHeads, responses, prompt, adapters, rl, attempt = 0) {
  const selectedResponses = normalizeResponses(responses).filter((response) => selectedHeads.includes(response.head));
  const responseByHead = new Map(selectedResponses.map((response) => [response.head, response]));
  const jobs = selectedResponses.map(async (response) => {
    const adapter = adapters.get(response.head);
    if (!adapter) {
      return {
        head: response.head,
        content: '',
        failed: true,
      };
    }

    const others = selectedResponses
      .filter((other) => other.head !== response.head)
      .map((other) => other.content)
      .join('\n\n');

    const mergePrompt = `MERGE REQUEST:
The user wants a unified response combining both approaches.

YOUR PREVIOUS RESPONSE:
${response.content}

OTHER HEAD'S RESPONSE:
${others}

Provide a single unified response that incorporates
the best elements of both approaches.`;

    try {
      const result = await adapter.sendPrompt('', mergePrompt, false);
      const tokens = extractResponseTokens(result);
      await recordBudgetUsage({
        head: response.head,
        model: result.model,
        tokens,
      });
      await writeTaskLog({
        type: 'decision.merge_response',
        decisionId: pendingDecision?.id,
        head: response.head,
        status: 'merged',
        prompt,
        response: result.text || '',
      });

      return {
        head: response.head,
        content: result.text || '',
        failed: false,
        source: responseByHead.get(response.head),
      };
    } catch (error) {
      const reason = sanitizeErrorMessage(error);
      await writeTaskLog({
        type: 'decision.merge_response',
        decisionId: pendingDecision?.id,
        head: response.head,
        status: 'failed',
        prompt,
        error: reason,
      });
      console.log(`${headTag(response.head)} merge failed: ${reason}`);
      return {
        head: response.head,
        content: '',
        failed: true,
        error: reason,
      };
    }
  });

  const mergedResponses = await Promise.all(jobs);
  const successfulResponses = mergedResponses.filter((response) => !response.failed);
  displayHeadResponses(successfulResponses);

  if (successfulResponses.length === 0) {
    console.log('[HYDRA] Merge failed: all heads errored. Rephrase and try again.');
    await append_entry(
      'DECISIONS',
      pendingDecision?.id || nextDecisionId(),
      `chose: none | topic: ${topicForPrompt(prompt)} Merge aborted: all heads failed.`,
    );
    clearPendingDecision();
    return { action: 'merge_failed', responses: mergedResponses };
  }

  const mergeAttempts = attempt + 1;
  if (!responsesAreDifferent(mergedResponses) || mergeAttempts < 2) {
    const decision = setPendingDecision({
      id: pendingDecision?.id,
      prompt,
      responses: successfulResponses,
      mergeAttempts,
    });

    if (responsesAreDifferent(mergedResponses)) {
      return showDecisionPrompt(decision.responses, prompt, rl, {
        adapters,
        decision,
      });
    }

    await append_entry('DECISIONS', decision.id, `chose: merged | topic: ${topicForPrompt(prompt)} Unified merge accepted.`);
    await append_entry('CONTEXT', decision.id, `Decision ${decision.id}: latest merged output accepted.`);
    clearPendingDecision();
    return { action: 'merged', decision };
  }

  return showMergeLoopExit({
    decision: setPendingDecision({
      id: pendingDecision?.id,
      prompt,
      responses: successfulResponses,
      mergeAttempts,
    }),
    adapters,
    rl,
  });
}

export async function logDecision(decisionData, hydraFile = readHydraFile()) {
  const { decision, choice, chosenHeads, rejectedHeads, summary } = decisionData;
  const chose = chosenHeads.join('+');
  await append_entry(
    'DECISIONS',
    decision.id,
    `chose: ${chose} | topic: ${topicForPrompt(decision.prompt)} ${summary}`,
  );
  await append_entry(
    'CONTEXT',
    decision.id,
    `Decision ${decision.id}: chose ${chose}; rejected ${rejectedHeads.length ? rejectedHeads.join(', ') : 'none'}.`,
  );
  void hydraFile;
}

export function getDecisionHistory(hydraFile = readHydraFile()) {
  return hydraFile.sections.DECISIONS.filter((entry) => (
    /^dec_\d+$/i.test(entry.author) || entry.content.includes('chose:')
  ));
}

export function rememberParallelResponses(prompt, responses) {
  const normalized = normalizeResponses(responses);
  if (normalized.length >= 2) {
    lastParallelResponses = {
      prompt,
      responses: normalized,
    };
  }
}

export function createPendingDecision(prompt, responses) {
  return setPendingDecision({
    prompt,
    responses,
    mergeAttempts: 0,
  });
}

export function getPendingDecision() {
  return pendingDecision;
}

export function getLastParallelDecision() {
  return lastParallelResponses;
}

export function clearPendingDecision() {
  pendingDecision = null;
}

export function loadDecisionFromTasks(decisionId, root = process.cwd()) {
  const paths = getProjectPaths(root);
  if (!fs.existsSync(paths.tasksLog)) {
    return null;
  }

  const entries = fs.readFileSync(paths.tasksLog, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => safeParseJson(line))
    .filter((entry) => entry?.decisionId === decisionId && entry.response);

  if (entries.length < 2) {
    return null;
  }

  return {
    id: decisionId,
    timestamp: new Date().toISOString(),
    prompt: entries[0].prompt || '',
    responses: entries.map((entry) => ({
      head: entry.head,
      content: entry.response,
    })),
    mergeAttempts: 0,
    status: 'pending',
  };
}

export async function logDecisionRevisit(decisionId, originalChoice, newChoice) {
  await append_entry(
    'DECISIONS',
    decisionId,
    `Revisited ${decisionId}  original choice: ${originalChoice || 'unknown'}  new choice: ${newChoice}`,
  );
}

function simpleDifferenceScore(textA, textB) {
  const wordsA = normalizedWordSet(textA);
  const wordsB = normalizedWordSet(textB);
  if (wordsA.size === 0 && wordsB.size === 0) {
    return 0;
  }

  const union = new Set([...wordsA, ...wordsB]);
  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      shared += 1;
    }
  }

  return (union.size - shared) / union.size;
}

function normalizedWordSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function normalizeResponses(responses) {
  return responses
    .map((response) => ({
      head: response.head,
      content: response.content ?? response.text ?? response.response?.text ?? '',
    }))
    .filter((response) => response.head);
}

function ensurePendingDecision(prompt, responses) {
  if (pendingDecision?.status === 'pending') {
    return pendingDecision;
  }

  return setPendingDecision({ prompt, responses, mergeAttempts: 0 });
}

function setPendingDecision({ id, prompt, responses, mergeAttempts = 0 }) {
  pendingDecision = {
    id: id || nextDecisionId(),
    timestamp: new Date().toISOString(),
    prompt,
    responses: normalizeResponses(responses),
    mergeAttempts,
    status: 'pending',
  };
  return pendingDecision;
}

function nextDecisionId() {
  const history = getDecisionHistory();
  const max = history.reduce((highest, entry) => {
    const match = `${entry.author} ${entry.content}`.match(/dec_(\d+)/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `dec_${String(max + 1).padStart(3, '0')}`;
}

function printDecisionPrompt(responses) {
  if (responses.length === 2) {
    printTwoHeadDecisionPrompt(responses);
    return;
  }

  printThreeHeadDecisionPrompt(responses.slice(0, 3));
}

function printTwoHeadDecisionPrompt(responses) {
  console.log(`
[HYDRA] 2 heads responded  approaches differ
            Your call.
`);

  responses.forEach((response, index) => {
    console.log('');
    console.log(`${headTag(response.head)} Option ${index === 0 ? 'A' : 'B'}`);
    console.log('');
    console.log(response.content);
  });

  console.log(`
What do you want to do?

  [A]   Follow ${headName(responses[0].head)}
  [B]   Follow ${headName(responses[1].head)}
  [M]   Merge both
  [S]   Split tracks
  [?]   Elaborate
  [X]   Ignore both  rephrase and try again
`);
}

function printThreeHeadDecisionPrompt(responses) {
  console.log(`
[HYDRA] 3 heads responded  approaches differ
            Your call.
`);

  responses.forEach((response, index) => {
    console.log('');
    console.log(`${headTag(response.head)} Option ${['A', 'B', 'C'][index]}`);
    console.log('');
    console.log(response.content);
  });

  console.log(`
What do you want to do?

  [A]    Follow ${headName(responses[0].head)}
  [B]    Follow ${headName(responses[1].head)}
  [C]    Follow ${headName(responses[2].head)}
  [AB]   Merge ${headName(responses[0].head)} + ${headName(responses[1].head)}
  [AC]   Merge ${headName(responses[0].head)} + ${headName(responses[2].head)}
  [BC]   Merge ${headName(responses[1].head)} + ${headName(responses[2].head)}
  [ALL]  Merge all three
  [S]    Split tracks
  [?]    Elaborate
  [X]    Ignore all  rephrase and try again
`);
}

async function handleDecisionChoice(choice, decision, rl, options) {
  const responses = decision.responses;
  const choiceMap = mapChoiceToHeads(choice, responses);

  if (choiceMap.action === 'follow') {
    return followSingleHead(choiceMap.head, decision);
  }

  if (choiceMap.action === 'merge') {
    for (const response of responses.filter((item) => choiceMap.heads.includes(item.head))) {
      await writeTaskLog({
        type: 'decision.response',
        decisionId: decision.id,
        prompt: decision.prompt,
        head: response.head,
        response: response.content,
        status: 'merged',
      });
    }
    return handleMerge(choiceMap.heads, responses, decision.prompt, options.adapters || new Map(), rl, decision.mergeAttempts);
  }

  if (choice === 'S') {
    printSplitConfirmation(responses);
    await logSplitDecision(decision);
    clearPendingDecision();
    return { action: 'split', heads: responses.map((response) => response.head), decision };
  }

  if (choice === '?') {
    await elaborateResponses(decision, options.adapters || new Map());
    return showDecisionPrompt(decision.responses, decision.prompt, rl, {
      ...options,
      decision,
    });
  }

  if (choice === 'X') {
    console.log('[HYDRA] All responses discarded. Rephrase and try again.');
    for (const response of responses) {
      await writeTaskLog({
        type: 'decision.response',
        decisionId: decision.id,
        prompt: decision.prompt,
        head: response.head,
        response: response.content,
        status: 'rejected_all',
      });
    }
    clearPendingDecision();
    return { action: 'ignore', decision };
  }

  console.log('[HYDRA] Invalid choice. Decision unchanged.');
  return showDecisionPrompt(responses, decision.prompt, rl, options);
}

function mapChoiceToHeads(choice, responses) {
  const optionHeads = {
    A: responses[0]?.head,
    B: responses[1]?.head,
    C: responses[2]?.head,
  };

  if (['A', 'B', 'C'].includes(choice) && optionHeads[choice]) {
    return { action: 'follow', head: optionHeads[choice] };
  }

  if (choice === 'M' && responses.length === 2) {
    return { action: 'merge', heads: responses.map((response) => response.head) };
  }

  if (choice === 'AB' && responses.length >= 3) {
    return { action: 'merge', heads: [responses[0].head, responses[1].head] };
  }

  if (choice === 'AC' && responses.length >= 3) {
    return { action: 'merge', heads: [responses[0].head, responses[2].head] };
  }

  if (choice === 'BC' && responses.length >= 3) {
    return { action: 'merge', heads: [responses[1].head, responses[2].head] };
  }

  if (choice === 'ALL' && responses.length >= 3) {
    return { action: 'merge', heads: responses.map((response) => response.head) };
  }

  return { action: 'unknown' };
}

async function followSingleHead(head, decision) {
  const chosen = decision.responses.find((response) => response.head === head);
  const rejected = decision.responses.filter((response) => response.head !== head);
  console.log(chosen.content);

  await logDecision({
    decision,
    choice: head,
    chosenHeads: [head],
    rejectedHeads: rejected.map((response) => response.head),
    summary: `User chose ${headName(head)}'s approach. ${rejected.map((response) => `${headName(response.head)} approach was rejected.`).join(' ')}`,
  });

  await writeTaskLog({
    type: 'decision.response',
    decisionId: decision.id,
    prompt: decision.prompt,
    head: chosen.head,
    response: chosen.content,
    status: 'completed',
  });

  for (const response of rejected) {
    await writeTaskLog({
      type: 'decision.response',
      decisionId: decision.id,
      prompt: decision.prompt,
      head: response.head,
      response: response.content,
      status: 'rejected',
    });
  }

  clearPendingDecision();
  return { action: 'follow', head, decision };
}

async function logSplitDecision(decision) {
  await append_entry(
    'DECISIONS',
    decision.id,
    `chose: split | topic: ${topicForPrompt(decision.prompt)} User chose split tracks.`,
  );
  await append_entry(
    'CONTEXT',
    decision.id,
    `Decision ${decision.id}: split mode active for ${decision.responses.map((response) => response.head).join(', ')}.`,
  );
}

async function elaborateResponses(decision, adapters) {
  const jobs = decision.responses.map(async (response) => {
    const adapter = adapters.get(response.head);
    if (!adapter) {
      return {
        head: response.head,
        content: '[Unable to elaborate: head adapter unavailable.]',
      };
    }

    const alternatives = decision.responses
      .filter((other) => other.head !== response.head)
      .map((other) => `${headName(other.head)}: ${summarize(other.content, 700)}`)
      .join('\n\n');

    const elaborationPrompt = `ELABORATION REQUEST:
The user wants you to explain your reasoning in depth.
Defend your approach and explain the specific tradeoffs
compared to the alternative approach.

YOUR PREVIOUS RESPONSE:
${response.content}

ALTERNATIVE APPROACH:
${alternatives}`;

    try {
      const result = await adapter.sendPrompt('', elaborationPrompt, false);
      const tokens = extractResponseTokens(result);
      await recordBudgetUsage({
        head: response.head,
        model: result.model,
        tokens,
      });

      return {
        head: response.head,
        content: result.text || '',
      };
    } catch (error) {
      return {
        head: response.head,
        content: `[Elaboration failed: ${sanitizeErrorMessage(error)}]`,
      };
    }
  });

  displayHeadResponses(await Promise.all(jobs));
}

async function showMergeLoopExit({ decision, adapters, rl }) {
  console.log(`
[HYDRA] Still not unified after 2 merge attempts.


  [U]   Use latest merged output as-is
  [?]   Ask one follow-up question to both heads
  [S]   Split tracks  each head works independently
  [X]   Stop  rephrase and start fresh
`);
  const choice = (await question(rl, 'Choice: ')).trim().toUpperCase();

  if (choice === 'U') {
    await append_entry('DECISIONS', decision.id, `chose: merged | topic: ${topicForPrompt(decision.prompt)} User used latest merged output as-is.`);
    clearPendingDecision();
    return { action: 'merged', decision };
  }

  if (choice === '?') {
    const followUp = await question(rl, 'Follow-up question: ');
    const prompt = `${decision.prompt}\n\nFOLLOW-UP QUESTION:\n${followUp}`;
    return handleMerge(
      decision.responses.map((response) => response.head),
      decision.responses,
      prompt,
      adapters,
      rl,
      0,
    );
  }

  if (choice === 'S') {
    printSplitConfirmation(decision.responses);
    await logSplitDecision(decision);
    clearPendingDecision();
    return { action: 'split', heads: decision.responses.map((response) => response.head), decision };
  }

  if (choice === 'X') {
    console.log('[HYDRA] All responses discarded. Rephrase and try again.');
    clearPendingDecision();
    return { action: 'ignore', decision };
  }

  console.log('[HYDRA] Invalid choice. Decision unchanged.');
  return showMergeLoopExit({ decision, adapters, rl });
}

function displayHeadResponses(responses) {
  for (const response of responses) {
    console.log('');
    console.log(`${headTag(response.head)} ${headName(response.head)}`);
    console.log(response.content || '[empty response]');
  }
}

function printSplitConfirmation(responses) {
  console.log('[HYDRA] Split mode  each head continues their own approach.');
  responses.forEach((response, index) => {
    console.log(`${headTag(response.head).padEnd(9)} Track ${['A', 'B', 'C'][index] || index + 1} is active.`);
  });
}

function headName(head) {
  return getHead(head)?.name || head;
}

function headTag(head) {
  return getHead(head)?.tag || `[${head.toUpperCase()}]`;
}

function topicForPrompt(prompt) {
  return String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function summarize(text, maxLength) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

async function question(rl, prompt) {
  if (typeof rl === 'function') {
    return rl(prompt);
  }

  return rl.question(prompt);
}

function safeParseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
