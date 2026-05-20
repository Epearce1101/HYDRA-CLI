export function truncateText(text, width) {
  const value = String(text || '');
  if (width <= 0 || value.length <= width) {
    return value;
  }
  if (width <= 3) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 3)}...`;
}

export function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

export function resolveKeyName(text, key = {}) {
  if (key.name) return key.name;
  const seq = key.sequence || text || '';
  if (seq === '\x1b[A') return 'up';
  if (seq === '\x1b[B') return 'down';
  if (seq === '\x1b[C') return 'right';
  if (seq === '\x1b[D') return 'left';
  if (seq === '\x1b[5~') return 'pageup';
  if (seq === '\x1b[6~') return 'pagedown';
  if (seq === '\x1b[H' || seq === '\x1b[1~' || seq === '\x1b[7~') return 'home';
  if (seq === '\x1b[F' || seq === '\x1b[4~' || seq === '\x1b[8~') return 'end';
  if (seq === '\x7f' || seq === '\b') return 'backspace';
  if (seq === '\t') return 'tab';
  if (seq === '\x1b') return 'escape';
  if (seq === '\r' || seq === '\n') return 'return';
  return '';
}
