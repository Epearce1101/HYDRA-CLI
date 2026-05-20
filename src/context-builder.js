import { readHydraFile } from './hydra-file.js';

const RECENT_DECISION_DAYS = 30;
const MEMORY_LIMIT = 10;

export function buildSystemContext({ head, prompt, connectedHeads, root = process.cwd(), now = new Date() }) {
  const hydraFile = readHydraFile(root);
  if (!hydraFile.validation.valid) {
    throw new Error(`Cannot build context from invalid .hydra file: ${hydraFile.validation.errors.join(' ')}`);
  }

  const connected = connectedHeads.filter((connectedHead) => connectedHead.connected);
  const otherHeads = connected
    .filter((connectedHead) => connectedHead.id !== head.id)
    .map((connectedHead) => connectedHead.name);

  const pinned = hydraFile.sections.PINNED;
  const recentDecisions = filterRecentEntries(hydraFile.sections.DECISIONS, RECENT_DECISION_DAYS, now);
  const relevantMemory = findRelevantMemory(activeMemoryEntries(hydraFile.sections.MEMORY), prompt, MEMORY_LIMIT);

  return {
    context: [
      'SYSTEM CONTEXT [injected automatically by Hydra]',
      '',
      `You are ${head.name} operating inside Hydra CLI.`,
      `You are one of ${connected.length} connected heads.`,
      `The other heads are: ${otherHeads.length ? otherHeads.join(', ') : 'none'}`,
      '',
      'PINNED FACTS:',
      formatEntryList(pinned),
      '',
      'RECENT DECISIONS:',
      formatEntryList(recentDecisions),
      '',
      'USER PROMPT:',
      prompt,
    ].join('\n'),
    metadata: {
      pinnedCount: pinned.length,
      recentDecisionCount: recentDecisions.length,
      relevantMemoryCount: relevantMemory.length,
      relevantMemory,
    },
  };
}

export function findRelevantMemory(entries, prompt, limit = MEMORY_LIMIT) {
  const promptTerms = tokenizeForRelevance(prompt);
  if (promptTerms.size === 0) {
    return entries.slice(-limit);
  }

  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: scoreEntry(entry, promptTerms),
    }))
    .filter((scored) => scored.score > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, limit)
    .map((scored) => scored.entry);
}

export function activeMemoryEntries(entries) {
  const lastClearIndex = entries.findLastIndex((entry) => (
    String(entry.content || '').toUpperCase().startsWith('MEMORY CLEARED')
  ));

  if (lastClearIndex === -1) {
    return entries;
  }

  return entries.slice(lastClearIndex + 1);
}

function filterRecentEntries(entries, days, now) {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
}

function formatEntryList(entries) {
  if (entries.length === 0) {
    return '- none';
  }

  return entries.map((entry) => `- ${entry.content}`).join('\n');
}

function scoreEntry(entry, promptTerms) {
  const entryTerms = tokenizeForRelevance(entry.content);
  let score = 0;
  for (const term of promptTerms) {
    if (entryTerms.has(term)) {
      score += 1;
    }
  }

  return score;
}

function tokenizeForRelevance(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}
