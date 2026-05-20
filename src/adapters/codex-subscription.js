import { SubscriptionAdapter } from './subscription-base.js';

export class CodexSubscriptionAdapter extends SubscriptionAdapter {
  constructor(head, env = process.env) {
    const sandbox = env.HYDRA_CODEX_SANDBOX || 'workspace-write';
    super(head, env, {
      binaryEnvVar: 'HYDRA_CODEX_BIN',
      defaultBinary: 'codex',
      timeoutEnvVar: 'HYDRA_CODEX_TIMEOUT_MS',
      defaultTimeoutMs: 180000,
      argsForPrompt: () => [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        sandbox,
        '-',
      ],
      stdinForPrompt: true,
    });
  }
}
