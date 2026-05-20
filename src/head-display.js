import { stdout as output } from 'node:process';
import { centerLine, colorize, terminalWidth } from './logo.js';
import { shouldPauseHead } from './budget.js';
import { getHealth } from './health.js';
import { HEAD_ROLES } from './provider-commands.js';
import { normalizeCommandName } from './command-registry.js';
import { formatModelShortName } from './model-display.js';
import { detectConnectedHeads } from './heads.js';

export function printPromptHeadIndicator(heads, width = terminalWidth(output)) {
  const block = formatPromptHeadIndicator(heads, width);
  for (const line of block.split('\n')) {
    console.log(centerLine(line, width));
  }
}

export function formatPromptHeadIndicator(heads, width) {
  if (heads.length === 0) return '';

  if (heads.length > 4) {
    const grid = formatPromptHeadIndicatorGrid(heads, width);
    if (grid) return grid;
  }

  const roomy = heads.map(formatPromptHeadIndicatorPart).join('     ');
  if (visibleTextLength(roomy) <= width) return roomy;

  const tight = heads.map((head) => formatPromptHeadIndicatorPart(head, { tight: true })).join(' ');
  if (visibleTextLength(tight) <= width) return tight;

  if (heads.length >= 2) {
    const half = Math.ceil(heads.length / 2);
    const top = heads.slice(0, half).map((head) => formatPromptHeadIndicatorPart(head, { tight: true })).join(' ');
    const bottom = heads.slice(half).map((head) => formatPromptHeadIndicatorPart(head, { tight: true })).join(' ');
    if (visibleTextLength(top) <= width && visibleTextLength(bottom) <= width) {
      return `${top}\n${bottom}`;
    }
  }

  const grid = formatPromptHeadIndicatorGrid(heads, width);
  if (grid) return grid;

  return `${heads.length} heads - /hydra heads to list`;
}

export function formatPromptHeadIndicatorPart(head, options = {}) {
  const status = promptHeadIndicatorStatus(head);
  const gap = options.tight ? '' : ' ';
  const label = truncateVisibleText(formatHeadShortLabel(head), options.labelWidth);
  return `${colorize(status.symbol, status.color)}${gap}${colorize(label, headDisplayColor(head))}`;
}

function formatPromptHeadIndicatorGrid(heads, width) {
  const minCellWidth = 18;
  const maxCellWidth = 24;
  const gapWidth = 2;
  let columns = Math.min(heads.length, 4, Math.max(1, Math.floor((width + gapWidth) / (minCellWidth + gapWidth))));

  while (columns > 1 && Math.floor((width - gapWidth * (columns - 1)) / columns) < minCellWidth) {
    columns -= 1;
  }

  const cellWidth = Math.min(maxCellWidth, Math.floor((width - gapWidth * (columns - 1)) / columns));
  if (!Number.isFinite(cellWidth) || cellWidth < 8) {
    return '';
  }

  const rows = [];
  for (let index = 0; index < heads.length; index += columns) {
    const slice = heads.slice(index, index + columns);
    const cells = Array.from({ length: columns }, (_, cellIndex) => {
      const head = slice[cellIndex];
      if (!head) {
        return ' '.repeat(cellWidth);
      }
      const cell = formatPromptHeadIndicatorPart(head, { labelWidth: Math.max(4, cellWidth - 2) });
      return padVisibleText(cell, cellWidth);
    });
    rows.push(cells.join(' '.repeat(gapWidth)));
  }
  return rows.join('\n');
}

function truncateVisibleText(text, width) {
  if (!Number.isFinite(width) || width <= 0) {
    return String(text || '');
  }
  const value = String(text || '');
  if (visibleTextLength(value) <= width) {
    return value;
  }
  if (width <= 3) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 3)}...`;
}

function padVisibleText(text, width) {
  const value = String(text || '');
  return `${value}${' '.repeat(Math.max(0, width - visibleTextLength(value)))}`;
}

export function promptHeadIndicatorStatus(head) {
  if (shouldPauseHead(head.id)) {
    return { symbol: '○', color: 'yellow' };
  }

  if (head.callable) {
    const health = getHealth(head.id);
    if (health.verified) {
      return { symbol: '●', color: 'green' };
    }
    if (health.fresh && health.error) {
      return { symbol: '!', color: 'yellow' };
    }
    if (head.connected) {
      return { symbol: '●', color: 'green' };
    }
    return { symbol: '!', color: 'yellow' };
  }

  if (head.authMode === 'subscription') {
    return { symbol: '!', color: 'yellow' };
  }

  return { symbol: '×', color: 'red' };
}

export function formatHeadShortLabel(head) {
  const model = head.model || head.defaultModel;
  return model ? formatModelShortName(model) : (head.name || head.id);
}

export function formatHeadDisplayName(head) {
  if (isRepurposedBuiltinHead(head)) {
    return formatHeadShortLabel(head);
  }
  return head.name || formatHeadShortLabel(head) || head.id;
}

export function formatHeadDisplayTag(head) {
  if (isRepurposedBuiltinHead(head)) {
    return tagFromLabel(formatHeadShortLabel(head));
  }
  return head.tag || tagFromLabel(head.name || head.id);
}

export function isRepurposedBuiltinHead(head) {
  if (!head?.builtin) {
    return false;
  }

  const provider = String(head.providerId || '').toLowerCase();
  const model = String(head.model || head.defaultModel || '').toLowerCase();
  const baseUrl = String(head.baseUrl || '').toLowerCase();

  if (head.id === 'claude') {
    return provider !== 'anthropic'
      || Boolean(baseUrl)
      || (model && !model.startsWith('claude-') && !model.includes('claude'));
  }

  if (head.id === 'codex') {
    return provider !== 'openai'
      || (Boolean(baseUrl) && !baseUrl.includes('api.openai.com'))
      || (model && !model.startsWith('gpt-') && !/^o\d/.test(model) && !model.startsWith('openai/'));
  }

  if (head.id === 'gemini') {
    return provider !== 'google-gemini'
      || Boolean(baseUrl)
      || (model && !model.includes('gemini'));
  }

  return false;
}

export function tagFromLabel(label) {
  const words = String(label || '')
    .replace(/[^A-Za-z0-9.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const text = words.slice(0, 2).join(' ').toUpperCase() || 'HEAD';
  return `[${text}]`;
}

export function headDisplayColor(head) {
  return head.color || roleDisplayColor(head.role) || 'white';
}

export function roleDisplayColor(roleKey) {
  return HEAD_ROLES[normalizeCommandName(roleKey)]?.color || null;
}

export function formatHeadStatusPrefix(head, options = {}) {
  const status = promptHeadIndicatorStatus(head);
  const gap = options.tight ? '' : ' ';
  return `${colorize(status.symbol, status.color)}${gap}`;
}

export function formatActiveHeadHeader(head) {
  const model = formatHeadShortLabel(head);
  const role = head.role ? ` role: ${head.role}` : '';
  return `${formatHeadStatusPrefix(head)}${colorize(formatHeadDisplayTag(head), headDisplayColor(head))} ${formatHeadDisplayName(head)} (${model})${role}`;
}

export function formatHeadStatusLine(head) {
  const role = head.role || 'none';
  const callable = head.callable ? 'callable' : 'not callable';
  return `${formatHeadStatusPrefix(head)}${colorize(formatHeadDisplayTag(head), headDisplayColor(head))} ${formatHeadDisplayName(head)} | model: ${formatHeadShortLabel(head)} | role: ${role} | ${callable}`;
}

export function printHeadStatusBlock(head, index = null) {
  const display = connectionDisplay(head);
  const status = colorize(display.label, display.color);
  const slot = Number.isInteger(index) ? `Head ${index + 1}` : 'Head';
  const role = head.role || 'none';
  const model = head.model || head.defaultModel || 'n/a';
  const builtinTag = head.builtin ? '' : colorize(' (custom)', 'purple');
  console.log(`  ${formatHeadStatusPrefix(head)}${slot}: ${colorize(formatHeadDisplayName(head), headDisplayColor(head))} ${colorize(formatHeadDisplayTag(head), headDisplayColor(head))}${builtinTag}`);
  console.log(`    Status:   ${status} (${head.connectionLabel})`);
  console.log(`    Model:    ${formatHeadShortLabel(head)} (${model})`);
  console.log(`    Provider: ${head.providerId || 'unknown'} | auth: ${head.authMode}`);
  console.log(`    Role:     ${role}`);
  if (!head.role && head.defaultRole) {
    console.log(`    Purpose:  ${head.defaultRole}`);
  }
}

export function visibleTextLength(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '').length;
}

export function subscriptionStatusDetail(head) {
  switch (head.subscriptionReason) {
    case 'awaiting_agreement':
      return 'awaiting subscription agreement (/hydra auth ' + head.id + ' subscription)';
    case 'no_binary_for_head':
      return 'no subscription backend defined for this head';
    case 'binary_missing':
      return `${head.subscriptionBinary || 'CLI'} not found on PATH (${head.subscriptionBinaryDetail || 'unavailable'})`;
    case 'ready':
      return `ready via ${head.subscriptionBinary}`;
    default:
      return 'subscription not callable';
  }
}

export function connectionDisplay(head) {
  if (head.callable) {
    return { label: 'READY', color: 'green' };
  }
  if (head.authMode === 'subscription') {
    return { label: 'LINKED', color: 'yellow' };
  }
  return { label: 'MISSING', color: 'red' };
}

export function formatHeadProviderModel(headId) {
  const status = detectConnectedHeads().find((head) => head.id === headId);
  if (!status) {
    return 'unknown';
  }
  const model = status.model || status.defaultModel || null;
  return `${status.providerId || 'unknown'} / ${formatModelShortName(model)} (${model || 'n/a'})`;
}
