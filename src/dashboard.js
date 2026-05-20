import fs from 'node:fs';
import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { colorize, systemLine, terminalWidth } from './logo.js';
import {
  formatHeadDisplayTag,
  formatHeadShortLabel,
  headDisplayColor,
  promptHeadIndicatorStatus,
  tagFromLabel,
} from './head-display.js';
import { detectConnectedHeads } from './heads.js';
import { getActivity, getRecentResponses, subscribeActivity } from './head-activity.js';
import { formatModelShortName } from './model-display.js';
import { getProjectPaths } from './project.js';
import { resolveKeyName, stripAnsi, truncateText } from './text-utils.js';
import { clearActiveInputRender, setActiveInputRender } from './io-state.js';
import { commandSuggestions, isCompleteCommand } from './completion.js';

const PANEL_INNER_WIDTH = 18;
const PANEL_OUTER_WIDTH = PANEL_INNER_WIDTH + 2;
const PANEL_GAP = 1;
const EDGE_MARGIN_COLUMNS = 4;
const REFRESH_MS = 400;
const FOOTER_TAIL_LINES = 6;
const RESPONSE_HISTORY_LIMIT = 1000;

let activeCleanup = null;
let activePause = null;
let activeResume = null;
let paused = false;

export function isDashboardActive() {
  return Boolean(activeCleanup) && !paused;
}

export function closeActiveDashboard(reason = 'programmatic') {
  if (activeCleanup) {
    activeCleanup(reason);
  }
}

export async function pauseActiveDashboard() {
  if (!activePause || paused) return false;
  await activePause();
  paused = true;
  return true;
}

export async function resumeActiveDashboard() {
  if (!activeResume || !paused) return false;
  paused = false;
  await activeResume();
  return true;
}

export async function runDashboard({ untilPromise = null, autoCloseOnIdle = false, onSubmit = null } = {}) {
  if (!input.isTTY || !output.isTTY) {
    console.log(systemLine('Dashboard requires a TTY. Use /status for a static snapshot.', 'yellow'));
    return { reason: 'no-tty' };
  }

  emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?1049h');
  output.write('\x1b[?25l');
  output.write('\x1b[2J\x1b[H');

  let frame = 0;
  let cleanedUp = false;
  let isPaused = false;
  let renderedLines = 0;
  let inputBuffer = '';
  let busy = false;
  let scrollOffset = 0;
  let refreshTimer = null;
  let suggestionIndex = 0;
  let lastPromptStartRow = null;
  let lastPromptRowCount = 0;
  let resolveExit;
  const dashboardStartedAt = Date.now();
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });

  const cleanup = (reason) => {
    if (cleanedUp) return;
    cleanedUp = true;
    activeCleanup = null;
    activePause = null;
    activeResume = null;
    paused = false;
    clearActiveInputRender();
    input.off('keypress', onKeypress);
    output.off('resize', onResize);
    input.setRawMode(wasRaw);
    output.write('\x1b[?25h');
    output.write('\x1b[?1049l');
    if (onSubmit) {
      writeDashboardResponsesToScrollback(dashboardStartedAt);
    }
    if (refreshTimer) clearInterval(refreshTimer);
    if (unsubscribe) unsubscribe();
    resolveExit({ reason });
  };
  activeCleanup = cleanup;

  const pause = async () => {
    if (cleanedUp) return;
    isPaused = true;
    input.off('keypress', onKeypress);
    output.off('resize', onResize);
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    clearActiveInputRender();
    input.setRawMode(wasRaw);
    output.write('\x1b[?25h');
    output.write('\x1b[?1049l');
  };
  const resume = async () => {
    if (cleanedUp) return;
    isPaused = false;
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    output.write('\x1b[?1049h');
    output.write('\x1b[?25l');
    output.write('\x1b[2J\x1b[H');
    renderedLines = 0;
    input.on('keypress', onKeypress);
    output.on('resize', onResize);
    setActiveInputRender(render);
    refreshTimer = setInterval(tick, REFRESH_MS);
    render();
  };
  activePause = pause;
  activeResume = resume;

  const render = () => {
    if (cleanedUp || isPaused) return;
    const heads = detectConnectedHeads();
    const termWidth = dashboardContentWidth(terminalWidth(output));
    const termRows = Math.max(15, output.rows || 24);

    const lines = [];
    const exitHint = onSubmit
      ? 'Esc/Ctrl+C/Ctrl+D to exit · PgUp/PgDn scroll · End jumps to latest'
      : 'q/Esc to exit';
    lines.push(`${colorize('[HYDRA DASHBOARD]', 'red')}  ${exitHint}  r to refresh`);
    lines.push(`${heads.length} head${heads.length === 1 ? '' : 's'} · refresh ${REFRESH_MS}ms · ${new Date().toLocaleTimeString()}`);
    lines.push('');

    const panels = heads.map((head, idx) => renderPanel(head, frame, idx));
    const panelsPerRow = Math.max(1, Math.floor((termWidth + PANEL_GAP) / (PANEL_OUTER_WIDTH + PANEL_GAP)));
    const rows = chunk(panels, panelsPerRow);
    for (const rowPanels of rows) {
      for (let lineIndex = 0; lineIndex < rowPanels[0].length; lineIndex += 1) {
        const segments = rowPanels.map((panel) => panel[lineIndex]);
        lines.push(segments.join(' '.repeat(PANEL_GAP)));
      }
      lines.push('');
    }

    const suggestions = onSubmit ? currentSuggestions() : [];
    if (suggestions.length === 0) {
      suggestionIndex = 0;
    } else if (suggestionIndex >= suggestions.length) {
      suggestionIndex = suggestions.length - 1;
    } else if (suggestionIndex < 0) {
      suggestionIndex = 0;
    }
    const promptBlock = onSubmit
      ? renderPromptBlock({ busy, frame, inputBuffer, termWidth, suggestions, suggestionIndex })
      : [];
    const contentRowBudget = promptBlock.length
      ? Math.max(0, termRows - promptBlock.length)
      : termRows;

    appendActivitySection(lines, { termWidth, rowBudget: contentRowBudget, compact: Boolean(onSubmit) });
    if (onSubmit) {
      scrollOffset = appendResponseSection(lines, { termWidth, rowBudget: contentRowBudget, scrollOffset });
    }

    const frameLines = promptBlock.length
      ? pinDashboardBlockToBottom(lines, promptBlock, termRows)
      : lines.slice(0, termRows);
    lastPromptStartRow = promptBlock.length ? Math.max(1, termRows - promptBlock.length + 1) : null;
    lastPromptRowCount = promptBlock.length;
    writeFrameInPlace(frameLines);

    if (autoCloseOnIdle && idleSince === null && heads.every((head) => !getActivity(head.id)?.inFlight)) {
      idleSince = Date.now();
    } else if (autoCloseOnIdle && heads.some((head) => getActivity(head.id)?.inFlight)) {
      idleSince = null;
    }
    if (autoCloseOnIdle && idleSince !== null && Date.now() - idleSince > 1500) {
      cleanup('idle');
    }
  };

  const writeFrameInPlace = (lines) => {
    const newCount = lines.length;
    let buf = '\x1b[?25l\x1b[?2026h\x1b[2J\x1b[H';
    for (let i = 0; i < newCount; i += 1) {
      buf += lines[i];
      buf += '\x1b[K';
      if (i < newCount - 1) {
        buf += '\n';
      }
    }
    buf += dashboardCursorParkSequence();
    output.write(buf);
    renderedLines = newCount;
  };

  const renderPromptOnly = () => {
    if (cleanedUp || isPaused || !onSubmit) return;
    const termWidth = dashboardContentWidth(terminalWidth(output));
    const termRows = Math.max(15, output.rows || 24);
    const suggestions = currentSuggestions();
    if (suggestions.length === 0) {
      suggestionIndex = 0;
    } else if (suggestionIndex >= suggestions.length) {
      suggestionIndex = suggestions.length - 1;
    } else if (suggestionIndex < 0) {
      suggestionIndex = 0;
    }
    const promptBlock = renderPromptBlock({ busy, frame, inputBuffer, termWidth, suggestions, suggestionIndex });
    const startRow = Math.max(1, termRows - promptBlock.length + 1);
    if (!lastPromptStartRow || lastPromptStartRow !== startRow || lastPromptRowCount !== promptBlock.length) {
      render();
      return;
    }
    let buf = '\x1b[?25l\x1b[?2026h';
    for (let index = 0; index < promptBlock.length; index += 1) {
      buf += `\x1b[${startRow + index};1H${promptBlock[index]}\x1b[K`;
    }
    const inputRow = startRow + Math.max(0, promptBlock.length - 2);
    const inputColumn = promptInputCursorColumn(inputBuffer, termWidth);
    buf += dashboardCursorParkSequence(inputRow, inputColumn);
    output.write(buf);
  };

  const hasAnimatedState = () => (
    busy || detectConnectedHeads().some((head) => getActivity(head.id)?.inFlight)
  );
  let idleSince = null;
  if (untilPromise && typeof untilPromise.then === 'function') {
    untilPromise.finally(() => cleanup('until-resolved'));
  }

  const currentSuggestions = () => {
    if (!onSubmit) return [];
    if (!inputBuffer.startsWith('/')) return [];
    if (isCompleteCommand(inputBuffer)) return [];
    return commandSuggestions(inputBuffer, 8);
  };

  const onKeypress = (text, key = {}) => {
    if (cleanedUp) return;
    const keyName = resolveKeyName(text, key);
    if (key.ctrl && (keyName === 'c' || text === '\x03')) return cleanup('ctrl-c');
    if (key.ctrl && (keyName === 'd' || text === '\x04')) return cleanup('ctrl-d');
    if (keyName === 'escape') return cleanup('user');

    if (!onSubmit) {
      if (text === 'q' || keyName === 'q') return cleanup('user');
      if (text === 'r' || keyName === 'r') render();
      return;
    }

    const suggestions = currentSuggestions();

    if (suggestions.length && keyName === 'tab') {
      const picked = suggestions[suggestionIndex] || suggestions[0];
      if (picked) {
        inputBuffer = picked;
        suggestionIndex = 0;
        renderPromptOnly();
      }
      return;
    }

    if (keyName === 'pageup') {
      scrollOffset += 5;
      render();
      return;
    }
    if (keyName === 'pagedown') {
      scrollOffset = Math.max(0, scrollOffset - 5);
      render();
      return;
    }
    if (keyName === 'home') {
      scrollOffset = Number.MAX_SAFE_INTEGER;
      render();
      return;
    }
    if (keyName === 'end') {
      scrollOffset = 0;
      render();
      return;
    }
    if (keyName === 'up') {
      if (suggestions.length) {
        suggestionIndex = suggestionIndex <= 0 ? suggestions.length - 1 : suggestionIndex - 1;
        renderPromptOnly();
        return;
      }
      if (!inputBuffer) {
        scrollOffset += 1;
        render();
        return;
      }
    }
    if (keyName === 'down') {
      if (suggestions.length) {
        suggestionIndex = (suggestionIndex + 1) % suggestions.length;
        renderPromptOnly();
        return;
      }
      if (scrollOffset > 0) {
        scrollOffset = Math.max(0, scrollOffset - 1);
        render();
        return;
      }
    }

    if (busy) return;
    if (keyName === 'return' || keyName === 'enter') {
      const trimmed = inputBuffer.trim();
      if (!trimmed) return;
      busy = true;
      const submitted = inputBuffer;
      inputBuffer = '';
      suggestionIndex = 0;
      renderPromptOnly();
      Promise.resolve(onSubmit(submitted))
        .catch(() => {})
        .finally(() => {
          busy = false;
          renderPromptOnly();
        });
      return;
    }
    if (keyName === 'backspace') {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        suggestionIndex = 0;
        renderPromptOnly();
      }
      return;
    }
    if (text && text.length === 1 && text >= ' ' && text <= '~' && !key.ctrl && !key.meta) {
      inputBuffer += text;
      suggestionIndex = 0;
      renderPromptOnly();
    }
  };

  const onResize = () => render();

  const tick = () => {
    if (!hasAnimatedState()) {
      return;
    }
    frame += 1;
    render();
  };

  input.on('keypress', onKeypress);
  output.on('resize', onResize);
  setActiveInputRender(render);
  const unsubscribe = subscribeActivity(() => render());
  refreshTimer = setInterval(tick, REFRESH_MS);
  render();

  return exitPromise;
}

function appendActivitySection(lines, { termWidth, rowBudget, compact = false }) {
  if (lines.length >= rowBudget) {
    return;
  }

  lines.push(colorize('─── Activity '.padEnd(termWidth, '─'), 'blue'));
  const availableRows = Math.max(0, rowBudget - lines.length);
  const compactLimit = Math.max(1, Math.min(FOOTER_TAIL_LINES, Math.floor(availableRows * 0.25) || 1));
  const tailLimit = compact ? compactLimit : Math.min(FOOTER_TAIL_LINES, availableRows);
  const tail = readActivityTail(tailLimit);
  if (tail.length === 0) {
    pushWithinBudget(lines, colorize('  (no events yet — task log empty)', 'yellow'), rowBudget);
    return;
  }
  for (const line of tail) {
    pushWithinBudget(lines, `  ${truncateText(line, termWidth - 2)}`, rowBudget);
  }
}

function appendResponseSection(lines, { termWidth, rowBudget, scrollOffset = 0 }) {
  if (lines.length >= rowBudget) {
    return Math.max(0, scrollOffset);
  }

  const responseRows = Math.max(0, rowBudget - lines.length - 1);
  const allResponseLines = renderRecentResponses(responseRows, termWidth);
  const maxOffset = Math.max(0, allResponseLines.length - responseRows);
  const clamped = Math.min(Math.max(0, scrollOffset), maxOffset);
  const scrollHint = allResponseLines.length > responseRows
    ? colorize(clamped > 0 ? `(scrolled +${clamped})` : '(PgUp scrolls)', 'yellow')
    : '';
  const heading = '─── Latest Responses ';
  const headingLine = scrollHint
    ? colorize(heading, 'green') + ' ' + scrollHint + ' ' + colorize('─'.repeat(Math.max(0, termWidth - heading.length - 2 - stripAnsi(scrollHint).length)), 'green')
    : colorize(heading.padEnd(termWidth, '─'), 'green');
  lines.push(headingLine);

  if (responseRows === 0) {
    return clamped;
  }

  if (allResponseLines.length === 0) {
    lines.push(colorize('  (responses will appear here)', 'yellow'));
    return 0;
  }
  const end = allResponseLines.length - clamped;
  const start = Math.max(0, end - responseRows);
  lines.push(...allResponseLines.slice(start, end));
  return clamped;
}

export function dashboardContentWidth(width) {
  const raw = Number(width || 80);
  return Math.max(40, raw - EDGE_MARGIN_COLUMNS);
}

export function promptInputCursorColumn(inputBuffer = '', termWidth = 80) {
  const visibleInput = truncateText(inputBuffer, Math.max(0, termWidth - 4));
  return Math.max(3, Math.min(termWidth, 3 + visibleInput.length));
}

function dashboardCursorParkSequence(row = 1, column = 1) {
  const safeRow = Math.max(1, Number(row) || 1);
  const safeColumn = Math.max(1, Number(column) || 1);
  return `\x1b[${safeRow};${safeColumn}H\x1b[?2026l\x1b[?25l`;
}

export function renderPromptBlock({ busy, frame = 0, inputBuffer, termWidth, suggestions = [], suggestionIndex = 0 }) {
  const hasSuggestions = suggestions.length > 0;
  const baseHint = busy
    ? '(sending)'
    : hasSuggestions
      ? 'Tab pick · Up/Down · Enter send · Esc close'
      : 'Enter to send · Esc to close';
  const hint = colorize(baseHint, busy ? 'yellow' : 'purple');
  const ARROW_VISIBLE = 2;
  const CARET_VISIBLE = 0;
  const MIN_GAP = 2;
  const inputWidth = Math.max(10, termWidth - baseHint.length - ARROW_VISIBLE - CARET_VISIBLE - MIN_GAP);
  const border = colorize('='.repeat(termWidth), 'purple');
  const arrow = colorize('>', 'purple');
  const lines = [border];
  if (hasSuggestions) {
    const maxLabelWidth = Math.max(10, termWidth - 4);
    suggestions.forEach((entry, idx) => {
      const marker = idx === suggestionIndex ? '>' : ' ';
      const label = truncateText(entry, maxLabelWidth);
      const rendered = idx === suggestionIndex ? colorize(label, 'red') : colorize(label, 'purple');
      lines.push(` ${marker} ${rendered}`);
    });
  }
  const inputDisplay = truncateText(inputBuffer, inputWidth);
  const leftVisible = ARROW_VISIBLE + inputDisplay.length + CARET_VISIBLE;
  const rightVisible = baseHint.length;
  const padding = Math.max(MIN_GAP, termWidth - leftVisible - rightVisible);
  lines.push(`${arrow} ${colorize(inputDisplay, 'purple')}${' '.repeat(padding)}${hint}`);
  lines.push(border);
  return lines;
}

export function pinDashboardBlockToBottom(contentLines, bottomLines, rows) {
  const totalRows = Math.max(0, rows);
  const bottom = bottomLines.slice(-totalRows);
  const contentBudget = Math.max(0, totalRows - bottom.length);
  const visibleContent = contentLines.slice(0, contentBudget);
  const filler = new Array(Math.max(0, contentBudget - visibleContent.length)).fill('');
  return [...visibleContent, ...filler, ...bottom];
}

function pushWithinBudget(lines, line, rowBudget) {
  if (lines.length < rowBudget) {
    lines.push(line);
  }
}

function renderPanel(head, frame, slotIndex = 0) {
  const activity = getActivity(head.id) || {};
  const status = promptHeadIndicatorStatus(head);
  const color = headDisplayColor(head);

  const inner = PANEL_INNER_WIDTH;
  const top = colorize(renderPanelTopBorder(slotIndex, inner), color);
  const bottom = colorize(`└${'─'.repeat(inner)}┘`, color);

  const headerText = `${status.symbol} ${formatHeadDisplayTag(head)}`;
  const modelText = formatHeadShortLabel(head);
  const roleText = head.role || activity.role || head.defaultRole || 'no role';

  const stateText = stateLabel(activity, frame);
  const detailText = detailLabel(activity);

  const lines = [
    top,
    panelLine(headerText, color),
    panelLine(modelText, color),
    panelLine(truncateText(roleText, inner - 2), color),
    panelLineStyled(stateText.text, color, stateText.color || color),
    panelLineStyled(detailText, color, 'white'),
    bottom,
  ];
  return lines;
}

function renderPanelTopBorder(slotIndex, inner) {
  const label = `HEAD ${slotIndex + 1}`;
  if (label.length >= inner) {
    return `┌${'─'.repeat(inner)}┐`;
  }
  const remaining = inner - label.length;
  const leftCount = Math.max(0, Math.floor(remaining / 3));
  const rightCount = remaining - leftCount;
  return `┌${'─'.repeat(leftCount)}${label}${'─'.repeat(rightCount)}┐`;
}

function panelLine(text, color) {
  return panelLineStyled(text, color, color);
}

function panelLineStyled(text, borderColor, textColor = borderColor) {
  const inner = PANEL_INNER_WIDTH;
  const padded = ` ${String(text || '').slice(0, inner - 2).padEnd(inner - 1)}`;
  return `${colorize('│', borderColor)}${colorize(padded, textColor)}${colorize('│', borderColor)}`;
}

function stateLabel(activity, frame) {
  if (activity?.inFlight) {
    const dots = '.'.repeat((frame % 3) + 1).padEnd(3);
    return { text: `thinking${dots}`, color: 'yellow' };
  }
  if (activity?.lastError) {
    return { text: 'failed', color: 'red' };
  }
  if (activity?.endedAt && Date.now() - activity.endedAt < 3000) {
    return { text: 'done', color: 'green' };
  }
  if (activity?.endedAt) {
    return { text: 'idle', color: null };
  }
  return { text: 'waiting', color: null };
}

function detailLabel(activity) {
  if (activity?.inFlight && activity.startedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - activity.startedAt) / 1000));
    return `${seconds}s elapsed`;
  }
  if (activity?.endedAt) {
    const ago = Math.max(0, Math.floor((Date.now() - activity.endedAt) / 1000));
    const tokens = activity.lastTokens ? ` · ${formatTokens(activity.lastTokens)}` : '';
    return ago < 60 ? `${ago}s ago${tokens}` : `${Math.floor(ago / 60)}m ago${tokens}`;
  }
  return '';
}

function renderRecentResponses(maxLines, width) {
  const entries = getRecentResponses(50).filter((entry) => entry.text || entry.error);
  if (entries.length === 0) return [];
  const headsById = currentHeadsById();
  const perEntryCap = Math.max(maxLines, 200);
  const allLines = [];
  for (const entry of entries) {
    allLines.push(...renderRecentResponseEntry(entry, headsById, width, perEntryCap));
  }
  return allLines;
}

function renderRecentResponseEntry(entry, headsById, width, maxLines) {
  const identity = dashboardEntryIdentity(entry, headsById);
  const lines = [];
  if (entry.prompt && lines.length < maxLines) {
    const prompt = normalizeInlineText(entry.prompt);
    const promptTextWidth = Math.max(8, width - 2 - '[USER] '.length);
    lines.push(`  ${colorize('[USER]', 'purple')} ${truncateText(prompt, promptTextWidth)}`);
  }

  if (lines.length >= maxLines) {
    return lines;
  }

  const label = formatDashboardResponseLabel(entry, headsById);
  const labelColor = entry.error ? 'red' : identity.color;
  lines.push(`  ${colorize(truncateText(label, width - 2), labelColor)}`);

  if (entry.error || lines.length >= maxLines) {
    return lines;
  }

  const bodyIndent = '    ';
  const body = String(entry.text || entry.preview || '');
  const bodyWidth = Math.max(10, width - 2 - bodyIndent.length);
  const paragraphs = body.split(/\r?\n/);
  for (const paragraph of paragraphs) {
    if (lines.length >= maxLines) break;
    const cleaned = paragraph.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      lines.push(`  ${bodyIndent}`);
      continue;
    }
    const remaining = Math.max(1, maxLines - lines.length);
    const wrapped = wrapText(cleaned, bodyWidth, remaining);
    for (const wrappedLine of wrapped) {
      if (lines.length >= maxLines) break;
      lines.push(`  ${bodyIndent}${colorize(wrappedLine, identity.color)}`);
    }
  }
  return lines;
}

export function formatDashboardResponseLines(entry, headsById = currentHeadsById(), width = terminalWidth(output), maxLines = 4) {
  return renderRecentResponseEntry(entry, headsById, width, maxLines);
}

export function formatDashboardResponseLabel(entry, headsById = currentHeadsById()) {
  const identity = dashboardEntryIdentity(entry, headsById);
  const at = entry.at ? new Date(entry.at).toLocaleTimeString() : '';
  if (entry.error) {
    return `${identity.tag} ${at} failed: ${entry.error}`;
  }
  return `${identity.tag} ${at}${identity.modelShort ? ` ${identity.modelShort}` : ''}`;
}

function dashboardEntryIdentity(entry, headsById = currentHeadsById()) {
  if (entry.headId === '_system') {
    return { tag: '[HYDRA]', modelShort: '', color: 'red' };
  }
  const head = entry.headId ? headsById.get(entry.headId) : null;
  const model = entry.model || head?.model || head?.defaultModel || null;
  const modelShort = model ? formatModelShortName(model) : '';
  if (head) {
    const displayHead = {
      ...head,
      model: model || head.model,
      defaultModel: model || head.defaultModel,
    };
    return {
      tag: formatHeadDisplayTag(displayHead),
      modelShort: modelShort === 'n/a' ? '' : modelShort,
      color: headDisplayColor(displayHead),
    };
  }
  if (modelShort && modelShort !== 'n/a') {
    return { tag: tagFromLabel(modelShort), modelShort, color: modelColor(model) };
  }
  return { tag: entry.headId ? `[${entry.headId.toUpperCase()}]` : '[HEAD]', modelShort: '', color: 'white' };
}

function currentHeadsById() {
  return new Map(detectConnectedHeads().map((head) => [head.id, head]));
}

function modelColor(model) {
  const value = String(model || '').toLowerCase();
  if (value.includes('claude')) return 'orange';
  if (value.includes('gemini')) return 'blue';
  if (value.includes('gpt') || /^o\d/.test(value) || value.includes('openai')) return 'white';
  if (value.includes('owl') || value.includes('openrouter')) return 'blue';
  return 'white';
}

function writeDashboardResponsesToScrollback(startedAt) {
  const entries = getRecentResponses(RESPONSE_HISTORY_LIMIT)
    .filter((entry) => entry.at >= startedAt)
    .filter((entry) => entry.text || entry.error);
  if (!entries.length) {
    return;
  }

  const headsById = currentHeadsById();
  const termWidth = terminalWidth(output);
  output.write('\n');
  output.write(`${systemLine('Dashboard responses', 'green')}\n`);
  for (const entry of entries) {
    const identity = dashboardEntryIdentity(entry, headsById);
    if (entry.prompt) {
      output.write(`\n${colorize('[USER]', 'purple')} ${normalizeInlineText(entry.prompt)}\n`);
    } else {
      output.write('\n');
    }
    output.write(`${colorize(formatDashboardResponseLabel(entry, headsById), entry.error ? 'red' : identity.color)}\n`);
    const hangingIndent = ' '.repeat(identity.tag.length + 1);
    if (entry.error) {
      output.write(`${hangingIndent}${colorize(`FAILED: ${entry.error}`, 'red')}\n`);
    } else {
      const bodyWidth = Math.max(20, termWidth - hangingIndent.length);
      const wrapped = wrapScrollbackBody(entry.text || '[empty response]', bodyWidth);
      for (const line of wrapped) {
        output.write(`${hangingIndent}${colorize(line, identity.color)}\n`);
      }
    }
  }
  output.write('\n');
}

function wrapScrollbackBody(text, width) {
  const limit = Math.max(10, width);
  const paragraphs = String(text).split(/\r?\n/);
  const out = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = '';
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= limit) {
        current += ` ${word}`;
      } else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

function normalizeInlineText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function wrapText(text, width, maxLines) {
  if (!text) {
    return ['[empty response]'];
  }
  const limit = Math.max(10, width);
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current += ` ${word}`;
    } else {
      lines.push(truncateText(current, limit));
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(truncateText(current, limit));
  }
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = truncateText(`${lines[lines.length - 1]} ...`, limit);
  }
  return lines;
}

function formatTokens(tokens) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K tok`;
  return `${tokens} tok`;
}

function chunk(items, perRow) {
  const result = [];
  for (let i = 0; i < items.length; i += perRow) {
    result.push(items.slice(i, i + perRow));
  }
  return result;
}

function readActivityTail(maxLines) {
  try {
    const paths = getProjectPaths();
    const tasksLog = paths.tasksLog;
    if (!fs.existsSync(tasksLog)) return [];
    const raw = fs.readFileSync(tasksLog, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const headsById = currentHeadsById();
    return lines.slice(-maxLines).map((line) => formatTaskLogLine(line, headsById)).filter(Boolean);
  } catch {
    return [];
  }
}

function formatTaskLogLine(rawLine, headsById) {
  try {
    const event = JSON.parse(rawLine);
    const at = event.at ? new Date(event.at).toLocaleTimeString() : '         ';
    const head = formatTaskEventHead(event, headsById);
    const type = event.type || 'event';
    const detail = formatEventDetail(event);
    return `${at}  ${head.padEnd(12)} ${type}${detail ? ` — ${detail}` : ''}`;
  } catch {
    return null;
  }
}

function formatTaskEventHead(event, headsById) {
  if (event.head) {
    return dashboardEntryIdentity({
      headId: event.head,
      model: event.model || null,
    }, headsById).tag;
  }
  if (event.model) {
    return tagFromLabel(formatModelShortName(event.model));
  }
  return '       ';
}

function formatEventDetail(event) {
  if (event.type === 'prompt.completed') {
    const tok = event.estimatedTokens ? `${event.estimatedTokens} tok` : '';
    const cost = event.estimatedCostUsd ? `$${Number(event.estimatedCostUsd).toFixed(4)}` : '';
    const model = event.model ? formatModelShortName(event.model) : '';
    return [model, tok, cost].filter(Boolean).join(' · ');
  }
  if (event.type === 'prompt.failed') return event.reason;
  if (event.type === 'mode.lead_selected') return `lead → ${event.head}`;
  if (event.type === 'head.added') return `provider: ${event.providerId}`;
  if (event.type === 'auth.mode_set') return `${event.head} → ${event.mode}`;
  return '';
}
