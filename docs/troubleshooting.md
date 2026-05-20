# Troubleshooting

Start with:

```powershell
node src/cli.js doctor
```

or, after linking:

```powershell
hydra doctor
```

## Claude Subscription CLI Is Missing

Claude subscription mode works through the installed Claude Code CLI. If doctor says `claude not found on PATH`, set:

```env
HYDRA_CLAUDE_BIN=%APPDATA%\npm\claude.cmd
```

Use `api-key` mode with an Anthropic Console API key when you want Hydra to make direct Anthropic SDK calls.

```powershell
node src/cli.js /hydra auth claude api-key
```

Then provide `ANTHROPIC_API_KEY` through `.hydra-state/.env` or the shell environment.

## Codex Subscription CLI Is Missing

Codex subscription mode works through the installed Codex CLI. If doctor says `codex not found on PATH`, set:

```env
HYDRA_CODEX_BIN=%APPDATA%\npm\codex.cmd
```

Use `api-key` mode with `OPENAI_API_KEY` for direct OpenAI SDK calls.

```powershell
node src/cli.js /hydra auth codex api-key
```

## A Head Cannot Run Claude/Codex Native Commands

API-backed heads use the `run_native_cli` Hydra tool. Check that the head is not in subscription mode if you expect native command calls to go through Hydra function tooling.

Subscription Claude and Codex heads run inside their own native CLIs. They should use:

```text
hydra native claude ...
hydra native codex ...
```

Claude Code also needs an allow-list for that bridge:

```env
HYDRA_CLAUDE_ALLOWED_TOOLS=Bash(hydra native *)
```

## Gemini API Key Fails

Check:

- `GOOGLE_API_KEY` exists in `.hydra-state/.env` or the shell environment.
- The key is from Google AI Studio or an API-enabled Google project.
- The selected model is available to the key.
- The account is not out of quota.

The default Gemini model is `gemini-2.5-flash-lite`.

## Invalid Or Missing API Key

Hydra never prints key values. Check the private env file directly:

```powershell
Get-Content .hydra-state/.env
```

Expected names:

```env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
```

## `.hydra` Validation Failed

The root `.hydra` file must keep these sections in this exact order:

```text
[PINNED]
[DECISIONS]
[MEMORY]
[NOTES]
[CONTEXT]
[PERMISSIONS LOG]
[BUDGET LOG]
```

Entries must use:

```text
- timestamp | author | content
```

Do not delete or reorder sections.

## Budget Heads Are Paused

Run:

```powershell
node src/cli.js /hydra budget
```

Options:

- Increase the limit with `/hydra budget add --$5.00`
- Set a new total with `/hydra budget set --$10.00`
- Disable tracking with `/hydra budget OFF`
- Reset session usage with `/hydra budget reset`

## Permission Command Is Blocked

Check current state:

```powershell
node src/cli.js /hydra permissions
```

For short-lived grants:

```powershell
node src/cli.js /hydra allow writes 10m
node src/cli.js /hydra allow command "npm test"
```

Destructive shell commands always require approval.

## Global `hydra` Does Not Launch

From the project root:

```powershell
npm link
hydra doctor
```

If needed, unlink and relink:

```powershell
npm unlink -g hydra-cli
npm link
```

## Run Local QA

```powershell
npm run check
npm run smoke
node src/cli.js doctor
```
