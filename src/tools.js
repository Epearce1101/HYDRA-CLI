import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import {
  nativePromptInvocation,
  resolveNativeProvider,
  runNativeCommandCapture,
} from './native-commands.js';
import {
  evaluateFileRead,
  evaluateFileWrite,
  evaluateCommandExecution,
  approveFileReadRequest,
  approveFileWriteRequest,
  approveCommandExecutionRequest,
} from './permissions.js';

const MAX_OUTPUT_CHARS = 16000;
const SHELL_TIMEOUT_MS = 30000;

export const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'read_file',
    description: 'Read the contents of a file inside the project. Paths are resolved relative to the project root.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative or absolute path to the file.' },
      },
      required: ['path'],
    },
  }),
  Object.freeze({
    name: 'write_file',
    description: 'Create or overwrite a file inside the project. Paths are resolved relative to the project root.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative or absolute path to the file.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  }),
  Object.freeze({
    name: 'list_dir',
    description: 'List the entries inside a directory in the project.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative or absolute directory path.' },
      },
      required: ['path'],
    },
  }),
  Object.freeze({
    name: 'run_shell',
    description: 'Run a shell command from the project root. Approval is required at most permission levels.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        cwd: { type: 'string', description: 'Optional working directory relative to project root.' },
      },
      required: ['command'],
    },
  }),
  Object.freeze({
    name: 'run_native_cli',
    description: 'Run an installed first-party Claude Code or Codex CLI command from the project root. Use this when any Hydra head needs Claude Code or Codex CLI commands, including --help, doctor, mcp, review, exec, or a headless prompt routed through that provider CLI.',
    input_schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Target native CLI: claude, claude-code, codex, or codex-cli.' },
        args: {
          type: 'array',
          description: 'CLI arguments passed directly to the provider binary, for example ["doctor"] or ["mcp", "list"]. Leave empty when using prompt.',
          items: { type: 'string' },
        },
        prompt: {
          type: 'string',
          description: 'Optional headless prompt to send through the provider CLI. If args is omitted, Hydra uses the provider headless mode automatically.',
        },
        stdin: { type: 'string', description: 'Optional stdin for the native command when args is provided.' },
        cwd: { type: 'string', description: 'Optional working directory relative to the project root.' },
        timeout_ms: { type: 'integer', description: 'Optional timeout in milliseconds, capped at 300000.' },
      },
      required: ['provider'],
    },
  }),
]);

export function getToolDefinitions() {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}

export async function executeTool({ name, input, head, ask, root = process.cwd() }) {
  try {
    if (name === 'read_file') {
      return await runReadFile({ input, head, ask, root });
    }
    if (name === 'write_file') {
      return await runWriteFile({ input, head, ask, root });
    }
    if (name === 'list_dir') {
      return await runListDir({ input, head, ask, root });
    }
    if (name === 'run_shell') {
      return await runShell({ input, head, ask, root });
    }
    if (name === 'run_native_cli') {
      return await runNativeCli({ input, head, ask, root });
    }
    return toolError(`Unknown tool "${name}".`);
  } catch (error) {
    return toolError(error?.message || String(error));
  }
}

async function runReadFile({ input, head, ask, root }) {
  const filePath = requireString(input?.path, 'path');
  const evaluation = evaluateFileRead(filePath, root);
  if (!evaluation.allowed) {
    if (!evaluation.approvalRequired) {
      return toolError(evaluation.reason);
    }
    const approved = await approveFileReadRequest({ head, file: filePath, ask });
    if (!approved) {
      return toolError(`Read denied by user: ${filePath}`);
    }
  }

  const resolved = resolveInsideRoot(filePath, root);
  if (!fs.existsSync(resolved)) {
    return toolError(`File not found: ${filePath}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return toolError(`Path is a directory, use list_dir: ${filePath}`);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  return toolSuccess(truncate(content));
}

async function runWriteFile({ input, head, ask, root }) {
  const filePath = requireString(input?.path, 'path');
  const content = input?.content;
  if (typeof content !== 'string') {
    return toolError('write_file requires a "content" string.');
  }

  const evaluation = evaluateFileWrite(filePath, root);
  if (!evaluation.allowed) {
    if (!evaluation.approvalRequired) {
      return toolError(evaluation.reason);
    }
    const preview = previewContent(content);
    const action = fs.existsSync(resolveInsideRoot(filePath, root)) ? 'overwrite' : 'create';
    const approved = await approveFileWriteRequest({
      head,
      action,
      file: filePath,
      size: `${Buffer.byteLength(content, 'utf8')} bytes`,
      preview,
      ask,
    });
    if (!approved) {
      return toolError(`Write denied by user: ${filePath}`);
    }
  }

  const resolved = resolveInsideRoot(filePath, root);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');
  return toolSuccess(`Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}`);
}

async function runListDir({ input, head, ask, root }) {
  const dirPath = requireString(input?.path, 'path');
  const evaluation = evaluateFileRead(dirPath, root);
  if (!evaluation.allowed) {
    if (!evaluation.approvalRequired) {
      return toolError(evaluation.reason);
    }
    const approved = await approveFileReadRequest({ head, file: dirPath, ask });
    if (!approved) {
      return toolError(`List denied by user: ${dirPath}`);
    }
  }

  const resolved = resolveInsideRoot(dirPath, root);
  if (!fs.existsSync(resolved)) {
    return toolError(`Directory not found: ${dirPath}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return toolError(`Path is not a directory: ${dirPath}`);
  }
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
    .map((entry) => `${entry.isDirectory() ? 'D' : 'F'} ${entry.name}`)
    .join('\n');
  return toolSuccess(truncate(entries || '(empty directory)'));
}

async function runShell({ input, head, ask, root }) {
  const command = requireString(input?.command, 'command');
  const cwdInput = typeof input?.cwd === 'string' && input.cwd.length > 0 ? input.cwd : '.';
  const cwd = resolveInsideRoot(cwdInput, root);

  const evaluation = evaluateCommandExecution(command, root);
  if (!evaluation.allowed) {
    if (!evaluation.approvalRequired) {
      return toolError(evaluation.reason);
    }
    const approved = await approveCommandExecutionRequest({ head, command, cwd, ask });
    if (!approved) {
      return toolError(`Command denied by user: ${command}`);
    }
  }

  const { stdout, stderr, code, timedOut } = await execCommand(command, cwd);
  const parts = [];
  if (stdout) {
    parts.push(`STDOUT:\n${stdout}`);
  }
  if (stderr) {
    parts.push(`STDERR:\n${stderr}`);
  }
  parts.push(`EXIT: ${code}${timedOut ? ' (timed out)' : ''}`);
  const body = truncate(parts.join('\n\n'));
  return code === 0 && !timedOut ? toolSuccess(body) : toolError(body);
}

async function runNativeCli({ input, head, ask, root }) {
  const providerInput = requireString(input?.provider, 'provider');
  const provider = resolveNativeProvider(providerInput);
  if (!provider) {
    return toolError(`Unknown native provider: ${providerInput}. Expected claude or codex.`);
  }

  const cwdInput = typeof input?.cwd === 'string' && input.cwd.length > 0 ? input.cwd : '.';
  const cwd = resolveInsideRoot(cwdInput, root);
  const prompt = typeof input?.prompt === 'string' ? input.prompt : '';
  let args = normalizeNativeArgs(input?.args);
  let stdin = typeof input?.stdin === 'string' ? input.stdin : '';

  if (prompt && args.length === 0) {
    const invocation = nativePromptInvocation(provider, prompt);
    args = invocation.args;
    stdin = invocation.stdin;
  } else if (prompt && !stdin) {
    stdin = prompt;
  }

  const timeoutMs = clampTimeout(input?.timeout_ms);
  const commandLabel = formatNativeCommandLabel(provider, args, Boolean(stdin));
  const evaluation = evaluateCommandExecution(commandLabel, root);
  if (!evaluation.allowed) {
    if (!evaluation.approvalRequired) {
      return toolError(evaluation.reason);
    }
    const approved = await approveCommandExecutionRequest({ head, command: commandLabel, cwd, ask });
    if (!approved) {
      return toolError(`Native CLI command denied by user: ${commandLabel}`);
    }
  }

  const { stdout, stderr, code, timedOut } = await runNativeCommandCapture({
    provider,
    args,
    stdin,
    cwd,
    timeoutMs,
    maxOutputChars: MAX_OUTPUT_CHARS,
  });
  const parts = [];
  if (stdout) {
    parts.push(`STDOUT:\n${stdout}`);
  }
  if (stderr) {
    parts.push(`STDERR:\n${stderr}`);
  }
  parts.push(`EXIT: ${code}${timedOut ? ' (timed out)' : ''}`);
  const body = truncate(parts.join('\n\n'));
  return code === 0 && !timedOut ? toolSuccess(body) : toolError(body);
}

function execCommand(command, cwd) {
  return new Promise((resolve) => {
    let timedOut = false;
    const child = exec(command, { cwd, timeout: SHELL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error?.killed) {
        timedOut = true;
      }
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: error?.code ?? 0,
        timedOut,
      });
    });

    child.on('error', (error) => {
      resolve({ stdout: '', stderr: error.message, code: -1, timedOut: false });
    });
  });
}

function normalizeNativeArgs(args) {
  if (!Array.isArray(args)) {
    return [];
  }

  return args.map((arg) => String(arg));
}

function clampTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 120000;
  }
  return Math.min(300000, Math.max(1000, Math.floor(parsed)));
}

function formatNativeCommandLabel(provider, args, hasStdin) {
  const base = ['hydra', 'native', provider, ...args].map(quoteCommandPart).join(' ');
  return hasStdin ? `${base} <stdin>` : base;
}

function quoteCommandPart(part) {
  const value = String(part);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function resolveInsideRoot(targetPath, root) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, targetPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path is outside project scope: ${targetPath}`);
  }
  return resolved;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required string parameter "${label}".`);
  }
  return value;
}

function previewContent(content) {
  const firstLines = content.split(/\r?\n/).slice(0, 5).join('\n');
  return truncate(firstLines, 400);
}

function truncate(text, limit = MAX_OUTPUT_CHARS) {
  const str = String(text ?? '');
  if (str.length <= limit) {
    return str;
  }
  return `${str.slice(0, limit)}\n... [truncated ${str.length - limit} chars]`;
}

function toolSuccess(output) {
  return { output: String(output ?? ''), isError: false };
}

function toolError(message) {
  return { output: String(message || 'tool error'), isError: true };
}
