import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { colorize, systemLine, terminalWidth } from './logo.js';
import { clearActiveInputRender, closeProcessQuestionInterface, setActiveInputRender } from './io-state.js';
import { resolveKeyName, truncateText } from './text-utils.js';

export const MENU_BACK = Symbol('menu-back');

export async function promptMenuChoice(ask, title, labels, defaultIndex = 0) {
  if (!canUseInteractiveMenu()) {
    return promptNumberedChoice(ask, title, labels, defaultIndex);
  }
  closeProcessQuestionInterface();
  return readMenuChoice({ title, labels, defaultIndex });
}

export function canUseInteractiveMenu() {
  return Boolean(input.isTTY && typeof input.setRawMode === 'function');
}

function normalizedKeyName(text, key = {}) {
  const seq = key.sequence || text || '';
  if (seq === '\x03') return 'c';
  return resolveKeyName(text, key);
}

export function readMenuChoice({ title, labels, defaultIndex = 0 }) {
  return new Promise((resolve) => {
    closeProcessQuestionInterface();
    emitKeypressEvents(input);
    const wasRaw = Boolean(input.isRaw);
    input.setRawMode(true);
    input.resume();
    output.write('\x1b[?25l');

    const visibleLimit = Math.min(12, Math.max(1, labels.length));
    let selectedIndex = Math.min(Math.max(defaultIndex, 0), Math.max(0, labels.length - 1));
    let viewportStart = 0;
    let renderedLines = 0;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      clearActiveInputRender();
      input.off('keypress', onKeypress);
      input.setRawMode(wasRaw);
      output.write('\x1b[?25h');
    };

    const clearRenderedBlock = () => {
      if (renderedLines > 0) {
        output.write(`\x1b[${renderedLines}A\r\x1b[0J`);
      } else {
        output.write('\r\x1b[0J');
      }
    };

    const render = () => {
      if (selectedIndex < viewportStart) {
        viewportStart = selectedIndex;
      }
      if (selectedIndex >= viewportStart + visibleLimit) {
        viewportStart = selectedIndex - visibleLimit + 1;
      }

      const visible = labels.slice(viewportStart, viewportStart + visibleLimit);
      const lines = [
        '',
        `${title}:`,
        ...visible.map((label, index) => {
          const actualIndex = viewportStart + index;
          const marker = actualIndex === selectedIndex ? '>' : ' ';
          const display = truncateText(label, Math.max(20, terminalWidth(output) - 6));
          return ` ${marker} ${actualIndex === selectedIndex ? colorize(display, 'red') : display}`;
        }),
      ];

      if (labels.length > visible.length) {
        lines.push(`   ${viewportStart + 1}-${viewportStart + visible.length} of ${labels.length}`);
      }
      lines.push('   Up/Down move  Enter select  Esc back');

      writeFrameInPlace(lines);
    };

    const writeFrameInPlace = (lines) => {
      if (renderedLines > 0) {
        output.write(`\x1b[${renderedLines}A\r`);
      } else {
        output.write('\r');
      }

      const newCount = lines.length;
      let buf = '';
      for (let index = 0; index < newCount; index += 1) {
        buf += `${lines[index]}\x1b[K\n`;
      }
      output.write(buf);

      if (renderedLines > newCount) {
        const extra = renderedLines - newCount;
        let trail = '';
        for (let index = 0; index < extra; index += 1) {
          trail += '\x1b[K\n';
        }
        trail += `\x1b[${extra}A`;
        output.write(trail);
      }

      renderedLines = newCount;
    };

    const finish = (value) => {
      clearRenderedBlock();
      if (value === MENU_BACK) {
        output.write(`${title}: back\n`);
      } else {
        output.write(`${title}: ${labels[value] || ''}\n`);
      }
      cleanup();
      resolve(value);
    };

    const onKeypress = (text, key = {}) => {
      const name = normalizedKeyName(text, key);
      if ((key.ctrl && name === 'c') || text === '\x03') {
        finish(MENU_BACK);
        return;
      }
      if (name === 'escape') {
        finish(MENU_BACK);
        return;
      }
      if (name === 'return' || name === 'enter') {
        finish(selectedIndex);
        return;
      }
      if (name === 'down' || name === 'right') {
        selectedIndex = (selectedIndex + 1) % labels.length;
        render();
        return;
      }
      if (name === 'up' || name === 'left') {
        selectedIndex = selectedIndex <= 0 ? labels.length - 1 : selectedIndex - 1;
        render();
        return;
      }
      if (name === 'pageup') {
        selectedIndex = Math.max(0, selectedIndex - visibleLimit);
        render();
        return;
      }
      if (name === 'pagedown') {
        selectedIndex = Math.min(labels.length - 1, selectedIndex + visibleLimit);
        render();
        return;
      }
      if (name === 'home') {
        selectedIndex = 0;
        render();
        return;
      }
      if (name === 'end') {
        selectedIndex = labels.length - 1;
        render();
      }
    };

    setActiveInputRender(render);
    input.on('keypress', onKeypress);
    render();
  });
}

export async function promptNumberedChoice(ask, title, labels, defaultIndex = 0) {
  console.log('');
  console.log(`${title}:`);
  labels.forEach((label, index) => {
    const marker = index === defaultIndex ? ' (default)' : '';
    console.log(`  ${index + 1}. ${label}${marker}`);
  });
  const answer = (await ask(`Choose ${title.toLowerCase()} [${defaultIndex + 1}]: `)).trim();
  if (!answer) {
    return defaultIndex;
  }
  if (['back', 'esc', 'escape'].includes(answer.toLowerCase())) {
    return MENU_BACK;
  }
  const index = Number.parseInt(answer, 10) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= labels.length) {
    console.log(systemLine(`Invalid ${title.toLowerCase()} choice.`, 'yellow'));
    return null;
  }
  return index;
}

export function readFilterableMenu({ title, catalog }) {
  closeProcessQuestionInterface();
  return new Promise((resolve) => {
    emitKeypressEvents(input);
    const wasRaw = Boolean(input.isRaw);
    input.setRawMode(true);
    input.resume();
    output.write('\x1b[?25l');

    let filter = '';
    let selectedIndex = 0;
    let viewportStart = 0;
    let renderedLines = 0;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearActiveInputRender();
      input.off('keypress', onKeypress);
      input.setRawMode(wasRaw);
      output.write('\x1b[?25h');
    };

    const clearRenderedBlock = () => {
      if (renderedLines > 0) {
        output.write(`\x1b[${renderedLines}A\r\x1b[0J`);
      } else {
        output.write('\r\x1b[0J');
      }
    };

    const matchesFilter = (entry) => {
      if (!filter) return true;
      const haystack = `${entry.name} ${entry.description} ${entry.slashForm || ''}`.toLowerCase();
      return haystack.includes(filter.toLowerCase());
    };

    const buildVisible = () => {
      const flat = [];
      const itemPositions = [];
      for (const section of catalog) {
        const matches = section.items.filter(matchesFilter);
        if (!matches.length) continue;
        flat.push({ kind: 'header', label: section.label });
        for (const item of matches) {
          itemPositions.push(flat.length);
          flat.push({ kind: 'item', entry: item });
        }
      }
      return { flat, itemPositions };
    };

    const render = () => {
      const { flat, itemPositions } = buildVisible();
      const totalItems = itemPositions.length;
      if (selectedIndex >= totalItems) {
        selectedIndex = Math.max(0, totalItems - 1);
      }

      const termWidth = Math.max(40, terminalWidth(output));
      const termRows = Math.max(10, output.rows || 24);
      const reserved = 7;
      const maxBodyLines = Math.max(5, termRows - reserved);

      const selectedFlatPos = totalItems > 0 ? itemPositions[selectedIndex] : 0;
      if (selectedFlatPos < viewportStart) {
        viewportStart = selectedFlatPos;
      } else if (selectedFlatPos >= viewportStart + maxBodyLines) {
        viewportStart = selectedFlatPos - maxBodyLines + 1;
      }
      const maxStart = Math.max(0, flat.length - maxBodyLines);
      viewportStart = Math.max(0, Math.min(viewportStart, maxStart));

      const slice = flat.slice(viewportStart, viewportStart + maxBodyLines);

      const headerLine = `${title} — type to filter, Tab to complete, Up/Down to move, Enter to pick, Esc to cancel`;
      const lines = [
        '',
        headerLine,
        `Filter: ${filter || '(none)'}`,
        '',
      ];

      if (totalItems === 0) {
        lines.push('  (no matches)');
      } else {
        for (const line of slice) {
          if (line.kind === 'header') {
            lines.push(colorize(`  ${line.label}`, 'blue'));
            continue;
          }
          const flatIdx = viewportStart + slice.indexOf(line);
          const itemIdx = itemPositions.indexOf(flatIdx);
          const isSelected = itemIdx === selectedIndex;
          const marker = isSelected ? '>' : ' ';
          const display = line.entry.slashForm || `/${line.entry.name}`;
          const text = `${display} — ${line.entry.description}`;
          const truncated = truncateText(text, termWidth - 6);
          lines.push(` ${marker} ${isSelected ? colorize(truncated, 'red') : truncated}`);
        }
      }

      if (totalItems > 0) {
        const above = viewportStart > 0;
        const below = viewportStart + maxBodyLines < flat.length;
        const cursorHint = `   item ${selectedIndex + 1} of ${totalItems}`;
        const scrollHint = (above || below) ? `${above ? '↑' : ' '}${below ? '↓' : ' '} more` : '';
        lines.push(`${cursorHint}${scrollHint ? `   ${scrollHint}` : ''}`);
      }

      writeFrameInPlace(lines);
    };

    const writeFrameInPlace = (lines) => {
      if (renderedLines > 0) {
        output.write(`\x1b[${renderedLines}A\r`);
      } else {
        output.write('\r');
      }

      const newCount = lines.length;
      let buf = '';
      for (let i = 0; i < newCount; i += 1) {
        buf += lines[i];
        buf += '\x1b[K\n';
      }
      output.write(buf);

      if (renderedLines > newCount) {
        const extra = renderedLines - newCount;
        let trail = '';
        for (let i = 0; i < extra; i += 1) {
          trail += '\x1b[K\n';
        }
        trail += `\x1b[${extra}A`;
        output.write(trail);
      }

      renderedLines = newCount;
    };

    const finish = (value) => {
      clearRenderedBlock();
      if (value === MENU_BACK) {
        output.write(`${title}: back\n`);
      } else {
        const display = value.slashForm || `/${value.name}`;
        output.write(`${title}: ${display}\n`);
      }
      cleanup();
      resolve(value);
    };

    const itemAt = (index) => {
      const { flat, itemPositions } = buildVisible();
      const pos = itemPositions[index];
      return pos === undefined ? null : flat[pos].entry;
    };

    const onKeypress = (text, key = {}) => {
      const name = normalizedKeyName(text, key);
      if ((key.ctrl && name === 'c') || text === '\x03') {
        finish(MENU_BACK);
        return;
      }
      if (name === 'escape') {
        finish(MENU_BACK);
        return;
      }
      if (name === 'return' || name === 'enter') {
        const entry = itemAt(selectedIndex);
        if (entry) finish(entry);
        return;
      }
      if (name === 'tab') {
        const entry = itemAt(selectedIndex);
        if (entry) {
          const display = entry.slashForm || `/${entry.name}`;
          const completed = display.replace(/^\//, '');
          if (completed !== filter) {
            filter = completed;
            selectedIndex = 0;
            viewportStart = 0;
            render();
          }
        }
        return;
      }
      if (name === 'down' || name === 'right') {
        const total = buildVisible().itemPositions.length;
        if (total > 0) {
          selectedIndex = (selectedIndex + 1) % total;
          render();
        }
        return;
      }
      if (name === 'up' || name === 'left') {
        const total = buildVisible().itemPositions.length;
        if (total > 0) {
          selectedIndex = selectedIndex <= 0 ? total - 1 : selectedIndex - 1;
          render();
        }
        return;
      }
      if (name === 'pageup') {
        const total = buildVisible().itemPositions.length;
        if (total > 0) {
          selectedIndex = Math.max(0, selectedIndex - 10);
          render();
        }
        return;
      }
      if (name === 'pagedown') {
        const total = buildVisible().itemPositions.length;
        if (total > 0) {
          selectedIndex = Math.min(total - 1, selectedIndex + 10);
          render();
        }
        return;
      }
      if (name === 'home') {
        selectedIndex = 0;
        viewportStart = 0;
        render();
        return;
      }
      if (name === 'end') {
        const total = buildVisible().itemPositions.length;
        if (total > 0) {
          selectedIndex = total - 1;
          render();
        }
        return;
      }
      if (name === 'backspace') {
        if (filter.length > 0) {
          filter = filter.slice(0, -1);
          selectedIndex = 0;
          viewportStart = 0;
          render();
        }
        return;
      }
      if (text && text.length === 1 && !key.ctrl && !key.meta && !name.startsWith('f')) {
        if (text >= ' ' && text <= '~') {
          filter += text;
          selectedIndex = 0;
          viewportStart = 0;
          render();
        }
      }
    };

    setActiveInputRender(render);
    input.on('keypress', onKeypress);
    render();
  });
}
