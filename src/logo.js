const ANSI = Object.freeze({
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  purple: '\x1b[35m',
  orange: '\x1b[38;5;208m',
  white: '\x1b[37m',
  cyan: '\x1b[38;5;51m',
  pink: '\x1b[38;5;213m',
  teal: '\x1b[38;5;43m',
});

export const LOGOS = Object.freeze({
  full: String.raw`
⠄⠄⣴⣶⣤⡤⠦⣤⣀⣤⠆⠄⠄⠄⠄⠄⣈⣭⣭⣿⣶⣿⣦⣼⣆⠄⠄⠄⠄⠄⠄⠄⠄
⠄⠄⠄⠉⠻⢿⣿⠿⣿⣿⣶⣦⠤⠄⡠⢾⣿⣿⡿⠋⠉⠉⠻⣿⣿⡛⣦⠄⠄⠄⠄⠄⠄
⠄⠄⠄⠄⠄⠈⠄⠄⠄⠈⢿⣿⣟⠦⠄⣾⣿⣿⣷⠄⠄⠄⠄⠻⠿⢿⣿⣧⣄⠄⠄⠄⠄
⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⣸⣿⣿⢧⠄⢻⠻⣿⣿⣷⣄⣀⠄⠢⣀⡀⠈⠙⠿⠄⠄⠄⠄
⠄⠄⢀⠄⠄⠄⠄⠄⠄⢠⣿⣿⣿⠈⠄⠄⠡⠌⣻⣿⣿⣿⣿⣿⣿⣿⣛⣳⣤⣀⣀⠄⠄
⠄⠄⢠⣧⣶⣥⡤⢄⠄⣸⣿⣿⠘⠄⠄⢀⣴⣿⣿⡿⠛⣿⣿⣧⠈⢿⠿⠟⠛⠻⠿⠄⠄
⠄⣰⣿⣿⠛⠻⣿⣿⡦⢹⣿⣷⠄⠄⠄⢊⣿⣿⡏⠄⠄⢸⣿⣿⡇⠄⢀⣠⣄⣾⠄⠄⠄
⣠⣿⠿⠛⠄⢀⣿⣿⣷⠘⢿⣿⣦⡀⠄⢸⢿⣿⣿⣄⠄⣸⣿⣿⡇⣪⣿⡿⠿⣿⣷⡄⠄
⠙⠃⠄⠄⠄⣼⣿⡟⠌⠄⠈⠻⣿⣿⣦⣌⡇⠻⣿⣿⣷⣿⣿⣿⠐⣿⣿⡇⠄⠛⠻⢷⣄
⠄⠄⠄⠄⠄⢻⣿⣿⣄⠄⠄⠄⠈⠻⣿⣿⣿⣷⣿⣿⣿⣿⣿⡟⠄⠫⢿⣿⡆⠄⠄⠄⠁
⠄⠄⠄⠄⠄⠄⠻⣿⣿⣿⣿⣶⣶⣾⣿⣿⣿⣿⣿⣿⣿⣿⡟⢀⣀⣤⣾⡿⠃⠄⠄⠄⠄
⠄⠄⠄⠄⢰⣶⠄⠄⣶⠄⢶⣆⢀⣶⠂⣶⡶⠶⣦⡄⢰⣶⠶⢶⣦⠄⠄⣴⣶⠄⠄⠄⠄
⠄⠄⠄⠄⢸⣿⠶⠶⣿⠄⠈⢻⣿⠁⠄⣿⡇⠄⢸⣿⢸⣿⢶⣾⠏⠄⣸⣟⣹⣧⠄⠄⠄
⠄⠄⠄⠄⠸⠿⠄⠄⠿⠄⠄⠸⠿⠄⠄⠿⠷⠶⠿⠃⠸⠿⠄⠙⠷⠤⠿⠉⠉⠿⠆⠄⠄`,
  compact: String.raw`
⠄⠄⣴⣶⣤⡤⠦⣤⣀⣤⠆⠄⠄⠄⠄⠄⣈⣭⣭⣿⣶⣿⣦⣼⣆⠄
⠄⠄⠄⠉⠻⢿⣿⠿⣿⣿⣶⣦⠤⠄⡠⢾⣿⣿⡿⠋⠉⠉⠻⣿⣿⡛⣦
⠄⠄⠄⠄⠄⠈⠄⠄⠄⠈⢿⣿⣟⠦⠄⣾⣿⣿⣷⠄⠄⠄⠄⠻⠿⢿⣿⣧
⠄⠄⠄⠄⠄⠄⠄⠄⠄⠄⣸⣿⣿⢧⠄⢻⠻⣿⣿⣷⣄⣀⠄⠢⣀⡀⠈⠙
⠄⠄⢰⣶⠄⠄⣶⠄⢶⣆⢀⣶⠂⣶⡶⠶⣦⡄⢰⣶⠶⢶⣦⠄⠄⣴⣶⠄
⠄⠄⢸⣿⠶⠶⣿⠄⠈⢻⣿⠁⠄⣿⡇⠄⢸⣿⢸⣿⢶⣾⠏⠄⣸⣟⣹⣧
⠄⠄⠸⠿⠄⠄⠿⠄⠄⠸⠿⠄⠄⠿⠷⠶⠿⠃⠸⠿⠄⠙⠷⠤⠿⠉⠉⠿`,
  inline: 'HYDRA  Cut one down, another spawns.',
  tiny: 'HYDRA CLI',
});

export const TITLES = Object.freeze({
  wide: String.raw`
  _   _ __   __ ____   ____      _       ____ _     ___
 | | | |\ \ / /|  _ \ |  _ \    / \     / ___| |   |_ _|
 | |_| | \ V / | | | || |_) |  / _ \   | |   | |    | |
 |  _  |  | |  | |_| ||  _ <  / ___ \  | |___| |___ | |
 |_| |_|  |_|  |____/ |_| \_\/_/   \_\  \____|_____|___|`,
  full: String.raw`
 _   _ __   __ ____   ____      _       ____ _     ___
| | | |\ \ / /|  _ \ |  _ \    / \     / ___| |   |_ _|
| |_| | \ V / | | | || |_) |  / _ \   | |   | |    | |
|  _  |  | |  | |_| ||  _ <  / ___ \  | |___| |___ | |
|_| |_|  |_|  |____/ |_| \_\/_/   \_\  \____|_____|___|`,
  medium: 'H Y D R A   C L I',
  small: 'HYDRA CLI',
});

export function colorize(text, color, enabled = supportsColor()) {
  if (!enabled || !ANSI[color]) {
    return text;
  }

  return `${ANSI[color]}${text}${ANSI.reset}`;
}

export function indentBlock(text, indent = 8) {
  const prefix = ' '.repeat(indent);
  return text
    .replace(/^\n/, '')
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

export function centerBlock(text, width = terminalWidth()) {
  const lines = normalizeBlock(text);
  const blockWidth = measureBlockWidth(lines);
  const padding = Math.max(0, Math.floor((width - blockWidth) / 2));
  const prefix = ' '.repeat(padding);
  return lines.map((line) => `${prefix}${line}`).join('\n');
}

export function centerLine(text, width = terminalWidth(), indent = 0) {
  const padding = Math.max(0, Math.floor((width - visibleLength(text)) / 2));
  return `${' '.repeat(indent + padding)}${text}`;
}

export function terminalWidth(output = process.stdout) {
  return Number(output?.columns || process.env.COLUMNS || 80);
}

export function logoWidth(text) {
  return measureBlockWidth(normalizeBlock(text));
}

export function bestTitleMode(width = terminalWidth()) {
  if (logoWidth(TITLES.wide) <= width) {
    return 'wide';
  }

  if (logoWidth(TITLES.full) <= width) {
    return 'full';
  }

  if (logoWidth(TITLES.medium) <= width) {
    return 'medium';
  }

  return 'small';
}

export function bestLogoMode(preferredMode, width = terminalWidth()) {
  if (preferredMode === 'off') {
    return 'off';
  }

  if (preferredMode === 'compact') {
    if (logoWidth(LOGOS.compact) <= width) {
      return 'compact';
    }

    return logoWidth(LOGOS.inline) <= width ? 'inline' : 'tiny';
  }

  if (preferredMode === 'inline') {
    return logoWidth(LOGOS.inline) <= width ? 'inline' : 'tiny';
  }

  if (logoWidth(LOGOS.full) <= width) {
    return 'full';
  }

  if (logoWidth(LOGOS.compact) <= width) {
    return 'compact';
  }

  return logoWidth(LOGOS.inline) <= width ? 'inline' : 'tiny';
}

export function supportsColor(env = process.env) {
  if (env.NO_COLOR) {
    return false;
  }

  return Boolean(process.stdout.isTTY);
}

export function systemLine(message, color = 'red') {
  return `${colorize('[HYDRA]', color)} ${message}`;
}

export function logoColorForConnectedHeads(heads) {
  const connected = heads.filter((head) => head.connected);
  if (connected.length === 1) {
    return connected[0].color;
  }

  return 'red';
}

function normalizeBlock(text) {
  return String(text || '')
    .replace(/^\n/, '')
    .split('\n');
}

function measureBlockWidth(lines) {
  return lines.reduce((max, line) => Math.max(max, visibleLength(line)), 0);
}

function visibleLength(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '').length;
}
