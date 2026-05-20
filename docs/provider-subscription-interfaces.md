# Provider Subscription Interfaces

This document records the current Hydra subscription-mode behavior.

## Decision (revised 2026-05-13)

The earlier policy kept subscription mode visible but non-callable for all heads. That policy is replaced by a consent-gated bridge that routes prompts through the providers' own first-party CLIs.

Hydra subscription mode is now callable for Claude and Codex when **all** of the following are true:

1. The user has explicitly accepted the in-CLI subscription agreement.
2. The corresponding provider CLI binary is installed on `PATH` (or pointed to via env var).
3. The user has logged into the provider CLI separately with their subscription account.

If any of those is missing, the head stays visibly `LINKED` and non-callable, with the doctor output naming the specific gap.

## What Hydra still will not do

Hydra does not:

- store provider session tokens
- scrape provider browser sessions
- reuse private app tokens
- reverse engineer native clients
- proxy prompts through unofficial endpoints

Subscription calls run through the official, user-installed provider CLIs that authenticate against the user's own subscription. Hydra only spawns those CLIs as subprocesses with the user-provided prompt.

## Subscription Agreement

Selecting `subscription` for a head triggers a one-time `[CAUTION] SUBSCRIPTION MODE AGREEMENT` prompt. The user must type literal `AGREE` to enable subscription calls. The acceptance is recorded in `.hydra-state/config.yaml`:

```yaml
subscription_agreement:
  accepted: true
  accepted_at: 2026-05-13T00:00:00.000Z
```

The prompt explicitly states that subscription use:

- may violate Anthropic and/or OpenAI terms of service
- may result in suspension or termination of the user's accounts
- can stop working at any time without notice

Acceptance is local to this project's state directory. It does not propagate to other Hydra installations.

## Claude

Status: callable via Claude Code CLI when agreement accepted and `claude` is on PATH.

Backend: `claude -p --input-format text --permission-mode acceptEdits --tools default --allowedTools "Bash(hydra native *)"` (Claude Code headless mode). Override the binary with `HYDRA_CLAUDE_BIN`. Override timeout with `HYDRA_CLAUDE_TIMEOUT_MS` (default 180000). Override the permission/tool defaults with `HYDRA_CLAUDE_PERMISSION_MODE`, `HYDRA_CLAUDE_TOOLS`, and `HYDRA_CLAUDE_ALLOWED_TOOLS`.

Subscription requests run through the user's own Claude Code installation. Hydra does not authenticate Claude; the user must already be signed in via `claude` itself.

## Codex / OpenAI

Status: callable via Codex CLI when agreement accepted and `codex` is on PATH.

Backend: `codex exec --skip-git-repo-check --sandbox workspace-write -` (Codex CLI non-interactive mode). Override the binary with `HYDRA_CODEX_BIN`. Override timeout with `HYDRA_CODEX_TIMEOUT_MS` (default 180000). Override the sandbox default with `HYDRA_CODEX_SANDBOX`.

Subscription requests run through the user's own Codex CLI installation. Hydra does not authenticate OpenAI; the user must already be signed in via `codex` itself.

## Gemini

Status: callable through API key. The earlier policy is unchanged.

The current implementation uses the official Google Generative AI SDK through `GOOGLE_API_KEY`. Subscription mode remains available for config symmetry but is not currently a callable Gemini path because Google has not published a corresponding first-party CLI that Hydra can shell out to.

## ToS Risk

Both Anthropic and OpenAI document paid Claude/ChatGPT subscriptions as covering their respective web/desktop/mobile/CLI surfaces only, and not third-party programmatic use. Using a third-party tool to shell out to a first-party CLI as a routing layer is a gray area: the call legitimately authenticates against the user's subscription through an official client, but the provider terms may still treat the wrapping as restricted use.

Hydra surfaces this risk via the in-CLI agreement. The compliance call sits with the user, not Hydra.

Relevant official docs:

- https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console
- https://docs.anthropic.com/en/api/overview
- https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions-even-if-i-have-a-paid-chatgpt-account.pls
- https://help.openai.com/en/articles/11369540
- https://developers.openai.com/codex/cli

## Budget Treatment

Subscription heads remain unmetered. With `budget.exclude_subscription_heads: true` (default), subscription calls do not draw against the budget limit. Hydra function-tool loops are not supported in subscription mode; Claude Code and Codex may still use their own first-party CLI tools according to the provider CLI flags and account permissions.

## Native CLI Passthrough

Hydra can run installed provider CLI commands directly:

```text
/hydra native claude --help
/hydra native claude doctor
/hydra native codex --help
/hydra native codex exec --help
```

Aliases:

```text
/hydra claude-code ...
/hydra codex-cli ...
```

Passthrough commands use the same `HYDRA_CLAUDE_BIN` and `HYDRA_CODEX_BIN` settings as subscription mode and run from the Hydra project root.

## Cross-Head Native Tool Access

Hydra exposes a guarded `run_native_cli` tool to API-backed heads. The tool accepts `provider`, `args`, optional `stdin`, optional `prompt`, optional `cwd`, and optional `timeout_ms`. It runs the selected first-party CLI from the project root and returns captured stdout/stderr/exit code.

Examples:

```text
run_native_cli provider=claude args=["doctor"]
run_native_cli provider=codex args=["mcp", "list"]
run_native_cli provider=claude prompt="Inspect this error and suggest a fix."
```

Subscription Claude and Codex heads cannot use Hydra function-tool loops directly because they are already running inside native provider CLIs. Hydra injects the bridge command into their context instead, and the project default allow-list lets Claude Code run `hydra native ...` commands through Bash without prompting while keeping broader Bash commands gated by Claude Code.

## Reset Path

Revoke acceptance by editing `.hydra-state/config.yaml`:

```yaml
subscription_agreement:
  accepted: false
  accepted_at: null
```

Or remove the entire `.hydra-state/` directory to reset all local config including the agreement.
