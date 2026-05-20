import { SubscriptionAdapter } from './subscription-base.js';

export class ClaudeSubscriptionAdapter extends SubscriptionAdapter {
  constructor(head, env = process.env) {
    const permissionMode = env.HYDRA_CLAUDE_PERMISSION_MODE || 'acceptEdits';
    const tools = env.HYDRA_CLAUDE_TOOLS || 'default';
    const allowedTools = env.HYDRA_CLAUDE_ALLOWED_TOOLS || 'Bash(hydra native *)';
    super(head, env, {
      binaryEnvVar: 'HYDRA_CLAUDE_BIN',
      defaultBinary: 'claude',
      timeoutEnvVar: 'HYDRA_CLAUDE_TIMEOUT_MS',
      defaultTimeoutMs: 180000,
      argsForPrompt: () => [
        '-p',
        '--input-format',
        'text',
        '--permission-mode',
        permissionMode,
        '--tools',
        tools,
        '--allowedTools',
        allowedTools,
      ],
      stdinForPrompt: true,
    });
  }
}
