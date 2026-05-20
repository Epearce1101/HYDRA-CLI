import { spawn } from 'node:child_process';
import { detectSubscriptionBinary } from './adapters/subscription-base.js';

const NATIVE_PROVIDERS = Object.freeze({
  claude: Object.freeze({
    id: 'claude',
    label: 'Claude Code',
    binaryEnvVar: 'HYDRA_CLAUDE_BIN',
    defaultBinary: 'claude',
  }),
  codex: Object.freeze({
    id: 'codex',
    label: 'Codex CLI',
    binaryEnvVar: 'HYDRA_CODEX_BIN',
    defaultBinary: 'codex',
  }),
});

const PROVIDER_ALIASES = Object.freeze({
  claude: 'claude',
  'claude-code': 'claude',
  claude_code: 'claude',
  codex: 'codex',
  'codex-cli': 'codex',
  codex_cli: 'codex',
});

function quoteWindowsShellArg(value) {
  const escaped = String(value)
    .replace(/\^/g, '^^')
    .replace(/%/g, '^%')
    .replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildWindowsShellCommand(binary, args) {
  return [binary, ...args].map(quoteWindowsShellArg).join(' ');
}

export function resolveNativeProvider(input) {
  return PROVIDER_ALIASES[String(input || '').toLowerCase()] || null;
}

export function formatNativeCommandHelp() {
  return [
    '[HYDRA] NATIVE CLI PASSTHROUGH',
    '',
    '/hydra native claude --help',
    '/hydra native claude doctor',
    '/hydra native claude mcp list',
    '/hydra native codex --help',
    '/hydra native codex exec --help',
    '/hydra native codex mcp list',
    '',
    'Aliases:',
    '/hydra claude-code ...',
    '/hydra codex-cli ...',
    '',
    'These commands run the installed provider CLI directly from the Hydra project root.',
  ].join('\n');
}

export async function runNativeCommand({ provider, args = [], env = process.env, cwd = process.cwd() }) {
  const command = resolveNativeCommand(provider, env);
  return spawnNative(command.resolvedBinary, normalizeArgs(args), {
    cwd,
    needsShell: command.needsShell,
  });
}

export async function runNativeCommandCapture({
  provider,
  args = [],
  stdin = '',
  env = process.env,
  cwd = process.cwd(),
  timeoutMs = 120000,
  maxOutputChars = 16000,
}) {
  const command = resolveNativeCommand(provider, env);
  return spawnNativeCapture(command.resolvedBinary, normalizeArgs(args), {
    cwd,
    needsShell: command.needsShell,
    stdin,
    timeoutMs,
    maxOutputChars,
  });
}

export function nativePromptInvocation(provider, prompt, env = process.env) {
  const providerId = resolveNativeProvider(provider);
  if (!providerId) {
    throw new Error(`Unknown native provider "${provider}". Expected claude or codex.`);
  }

  if (providerId === 'claude') {
    return {
      provider: providerId,
      args: ['-p', '--input-format', 'text'],
      stdin: String(prompt || ''),
    };
  }

  const sandbox = env.HYDRA_CODEX_SANDBOX || 'workspace-write';
  return {
    provider: providerId,
    args: ['exec', '--skip-git-repo-check', '--sandbox', sandbox, '-'],
    stdin: String(prompt || ''),
  };
}

function resolveNativeCommand(provider, env) {
  const providerId = resolveNativeProvider(provider);
  if (!providerId) {
    throw new Error(`Unknown native provider "${provider}". Expected claude or codex.`);
  }
  const config = NATIVE_PROVIDERS[providerId];
  const binary = env[config.binaryEnvVar] || config.defaultBinary;
  const detection = detectSubscriptionBinary(binary);
  if (!detection.available) {
    throw new Error(`${config.label} is not available: ${detection.error}. Set ${config.binaryEnvVar} if needed.`);
  }

  return {
    providerId,
    label: config.label,
    binary,
    resolvedBinary: detection.resolvedBinary || binary,
    needsShell: Boolean(detection.needsShell),
  };
}

function spawnNative(binary, args, { cwd, needsShell }) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' && needsShell
      ? buildWindowsShellCommand(binary, args)
      : binary;
    const child = process.platform === 'win32' && needsShell
      ? spawn(command, {
        cwd,
        stdio: 'inherit',
        shell: true,
        windowsHide: false,
      })
      : spawn(command, args, {
        cwd,
        stdio: 'inherit',
        shell: false,
        windowsHide: false,
      });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function spawnNativeCapture(binary, args, { cwd, needsShell, stdin, timeoutMs, maxOutputChars }) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' && needsShell
      ? buildWindowsShellCommand(binary, args)
      : binary;
    const stdio = [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'];
    const child = process.platform === 'win32' && needsShell
      ? spawn(command, {
        cwd,
        stdio,
        shell: true,
        windowsHide: true,
      })
      : spawn(command, args, {
        cwd,
        stdio,
        shell: false,
        windowsHide: true,
      });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = truncateCaptured(`${stdout}${chunk.toString('utf8')}`, maxOutputChars);
    });
    child.stderr.on('data', (chunk) => {
      stderr = truncateCaptured(`${stderr}${chunk.toString('utf8')}`, maxOutputChars);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: code ?? (signal ? 1 : 0),
        signal,
        timedOut,
        stdout,
        stderr,
      });
    });

    if (stdin) {
      child.stdin.end(stdin);
    }
  });
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) {
    return [];
  }

  return args.map((arg) => String(arg));
}

function truncateCaptured(value, limit) {
  if (value.length <= limit) {
    return value;
  }
  const omitted = value.length - limit;
  return `${value.slice(0, limit)}\n... [truncated ${omitted} chars]`;
}
