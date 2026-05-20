import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AdapterError, buildAdapterResponse, estimateTokens, sanitizeErrorMessage } from './base.js';

const binaryAvailabilityCache = new Map();

function hasWindowsPathSegment(binary) {
  return path.win32.isAbsolute(binary) || /[\\/]/.test(binary);
}

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

function quoteWindowsWherePattern(binary) {
  if (/^[A-Za-z0-9_.-]+$/.test(binary)) {
    return binary;
  }
  return quoteWindowsShellArg(binary);
}

function candidateWindowsPaths(binary) {
  if (!hasWindowsPathSegment(binary)) {
    return [];
  }

  const ext = path.win32.extname(binary);
  if (ext) {
    return [binary];
  }

  return [`${binary}.cmd`, `${binary}.exe`, `${binary}.bat`, binary];
}

function pickWindowsCandidate(candidates, requestedBinary) {
  const normalized = candidates.map((candidate) => candidate.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return '';
  }

  const requestedExt = path.win32.extname(requestedBinary).toLowerCase();
  if (requestedExt) {
    return normalized.find((candidate) => (
      path.win32.extname(candidate).toLowerCase() === requestedExt
    )) || normalized[0];
  }

  const rank = new Map([
    ['.cmd', 0],
    ['.exe', 1],
    ['.bat', 2],
    ['', 3],
  ]);
  return normalized.sort((left, right) => {
    const leftRank = rank.get(path.win32.extname(left).toLowerCase()) ?? 4;
    const rightRank = rank.get(path.win32.extname(right).toLowerCase()) ?? 4;
    return leftRank - rightRank;
  })[0];
}

function resolveWindowsBinary(binary) {
  const localCandidate = pickWindowsCandidate(
    candidateWindowsPaths(binary).filter((candidate) => fs.existsSync(candidate)),
    binary,
  );
  if (localCandidate) {
    return { resolvedBinary: localCandidate, needsShell: true };
  }

  if (hasWindowsPathSegment(binary)) {
    return { error: `${binary} not found` };
  }

  const lookup = spawnSync('cmd.exe', ['/d', '/s', '/c', `where ${quoteWindowsWherePattern(binary)}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3000,
    windowsHide: true,
  });

  if (lookup.error) {
    return { error: sanitizeErrorMessage(lookup.error) };
  }

  const matches = String(lookup.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const resolvedBinary = pickWindowsCandidate(matches, binary);
  if (!resolvedBinary) {
    const detail = String(lookup.stderr || '').trim();
    return { error: detail || `${binary} not found on PATH` };
  }

  return { resolvedBinary, needsShell: true };
}

function probeBinary(binary, args, needsShell) {
  if (process.platform === 'win32' && needsShell) {
    return spawnSync(buildWindowsShellCommand(binary, args), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      timeout: 3000,
      windowsHide: true,
    });
  }

  return spawnSync(binary, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    timeout: 3000,
    windowsHide: true,
  });
}

export function detectSubscriptionBinary(binary) {
  if (!binary) {
    return { available: false, error: 'no binary configured' };
  }

  if (binaryAvailabilityCache.has(binary)) {
    return binaryAvailabilityCache.get(binary);
  }

  let resolvedBinary = binary;
  let needsShell = false;
  if (process.platform === 'win32') {
    const resolution = resolveWindowsBinary(binary);
    if (resolution.error) {
      const result = { available: false, error: sanitizeErrorMessage(resolution.error) };
      binaryAvailabilityCache.set(binary, result);
      return result;
    }
    resolvedBinary = resolution.resolvedBinary;
    needsShell = resolution.needsShell;
  }

  let result = { available: false, error: `${binary} not found on PATH` };
  try {
    const probe = probeBinary(resolvedBinary, ['--version'], needsShell);

    if (probe.error) {
      result = { available: false, error: sanitizeErrorMessage(probe.error) };
    } else if (probe.status !== 0) {
      result = {
        available: false,
        error: `${resolvedBinary} --version exited ${probe.status}`,
      };
    } else {
      const version = String(probe.stdout || '').trim().split('\n')[0] || '';
      result = {
        available: true,
        version,
        resolvedBinary,
        needsShell,
      };
    }
  } catch (error) {
    result = { available: false, error: sanitizeErrorMessage(error) };
  }

  binaryAvailabilityCache.set(binary, result);
  return result;
}

export function resetSubscriptionBinaryCache() {
  binaryAvailabilityCache.clear();
}

export class SubscriptionAdapter {
  constructor(head, env, config) {
    this.id = head.id;
    this.name = head.name;
    this.head = head;
    this.binary = env[config.binaryEnvVar] || config.defaultBinary;
    this.argsForPrompt = config.argsForPrompt;
    this.stdinForPrompt = Boolean(config.stdinForPrompt);
    this.timeoutMs = Number(env[config.timeoutEnvVar]) || config.defaultTimeoutMs || 120000;
    this.lastConnectionError = '';
    this.model = head.model || head.defaultModel;
    this.subscriptionMode = true;
  }

  async connect() {
    const detection = detectSubscriptionBinary(this.binary);
    if (!detection.available) {
      this.lastConnectionError = detection.error;
      return false;
    }

    try {
      const ping = 'ping';
      const args = this.argsForPrompt(ping);
      const stdin = this.stdinForPrompt ? ping : '';
      const text = await this.#runBinary(args, stdin, { timeoutMs: 15000 });
      if (!text || !text.trim()) {
        this.lastConnectionError = 'empty response from subscription CLI';
        return false;
      }
      return true;
    } catch (error) {
      this.lastConnectionError = sanitizeErrorMessage(error?.message || error);
      return false;
    }
  }

  async sendPrompt(context, prompt, _stream = false, options = {}) {
    if (options.tools && options.tools.length > 0) {
      throw new AdapterError(
        `${this.name} subscription mode does not support tool use. Switch to api-key mode for tool calls.`,
      );
    }

    const combinedPrompt = context && context.trim() ? `${context}\n\n${prompt}` : prompt;
    const args = this.argsForPrompt(combinedPrompt);
    const stdin = this.stdinForPrompt ? combinedPrompt : '';
    const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
    const text = await this.#runBinary(args, stdin, { onChunk });

    const estimatedTokens = this.getTokenCount(`${combinedPrompt}\n${text}`);
    return buildAdapterResponse({
      head: this.id,
      model: this.model,
      text,
      raw: null,
      usage: { estimated: true },
      estimatedTokens,
      estimatedCostUsd: 0,
    });
  }

  getTokenCount(text) {
    return estimateTokens(text);
  }

  getEstimatedCost() {
    return 0;
  }

  abort() {
    const proc = this._activeProcess;
    if (proc && !proc.killed) {
      try { proc.kill(); } catch { /* already gone */ }
    }
  }

  #runBinary(args, stdin = '', options = {}) {
    const detection = detectSubscriptionBinary(this.binary);
    const resolved = detection.available && detection.resolvedBinary
      ? detection.resolvedBinary
      : this.binary;
    const useShell = Boolean(detection.needsShell);
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    return new Promise((resolve, reject) => {
      const command = process.platform === 'win32' && useShell
        ? buildWindowsShellCommand(resolved, args)
        : resolved;
      const stdio = [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'];
      const proc = process.platform === 'win32' && useShell
        ? spawn(command, {
          stdio,
          shell: true,
          windowsHide: true,
        })
        : spawn(command, args, {
          stdio,
          shell: false,
          windowsHide: true,
        });
      this._activeProcess = proc;
      let stdout = '';
      let stderr = '';
      const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stdout += text;
        if (onChunk) {
          try { onChunk(text); } catch { /* ignore listener errors */ }
        }
      });
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      if (stdin) {
        proc.stdin.end(stdin);
      }

      const timer = setTimeout(() => {
        proc.kill();
        reject(new AdapterError(`${this.binary} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.on('error', (err) => {
        clearTimeout(timer);
        this._activeProcess = null;
        reject(new AdapterError(sanitizeErrorMessage(err)));
      });
      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        this._activeProcess = null;
        if (signal) {
          reject(new AdapterError(`${this.binary} cancelled (${signal})`));
          return;
        }
        if (code !== 0) {
          const detail = sanitizeErrorMessage(stderr.trim().slice(-500) || `exit ${code}`);
          reject(new AdapterError(`${this.binary} exited ${code}: ${detail}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}
