# Hydra CLI

Hydra CLI is a local-first terminal workspace for working with many AI models at once.

Instead of treating every model as the same assistant, Hydra lets you assign heads to roles like `chat`, `code`, `debug`, `test`, `review`, `secure`, `advisor`, `judge`, and `oracle`. You can talk to one head, broadcast to many, or use workflow/orchestration commands that coordinate several heads around the same task.

> Cut one down, another spawns.

## What Hydra Does

- Run multiple AI heads from one terminal.
- Assign role tags to heads so prompts route to the right specialist.
- Use a dashboard view to watch head status, activity, and responses.
- Send prompts to one head, all heads, or a role group.
- Coordinate coding workflows with Oracle, Architect, Judge, and worker roles.
- Store local project memory, recent decisions, task artifacts, and session transcripts.
- Support API-key providers, OpenAI-compatible providers, and supported native CLI bridges.

## Who It Is For

Hydra is built for people who want a stronger AI coding and planning workspace than a single chat window:

- Developers comparing several models.
- Power users building model teams with roles.
- Teams testing multi-agent coding workflows.
- Users who want local project state and terminal-first control.

## Requirements

- Node.js 20 or newer
- A terminal such as Windows Terminal, PowerShell, or another modern shell
- At least one configured provider/API key or supported local/native model path

## Quick Start

```powershell
npm install
npm start
```

You can also run Hydra directly:

```powershell
node hydra-home.js
```

Once inside Hydra, start with:

```text
/help
/setup
/setup head new
/heads
/dash
```

## Basic Workflow

1. Run `/setup head new`.
2. Choose a provider and model.
3. Assign a role such as `chat`, `code`, `review`, or `judge`.
4. Repeat for as many heads as you want.
5. Use `/dash` to work from the live dashboard.
6. Use role commands like `/code "fix this"` or `/review "check this plan"`.

Hydra has a soft warning after several heads because the interface can get crowded, but larger Hydra teams are supported.

## Common Commands

| Command | Purpose |
| --- | --- |
| `/help` | Show command help. |
| `/setup` | Configure provider auth and heads. |
| `/setup head new` | Add a new head with guided setup. |
| `/heads` | Show configured heads and status. |
| `/roles` | Show available role commands. |
| `/dash` | Open the live dashboard. |
| `/chat "prompt"` | Send a normal chat prompt. |
| `/code "prompt"` | Route to a coding head. |
| `/all "prompt"` | Send to all callable heads. |
| `/remove head 4` | Remove a head by slot number. |
| `/doctor` | Run health checks. |
| `/status` | Show current mode, heads, budget, and session info. |

More commands are documented in [COMMANDS.MD](COMMANDS.MD).

## Roles

Roles are simple tags that tell Hydra what a head should be used for. A model is not locked to a role forever; you can change role assignments as your workflow changes.

Useful starter roles:

| Role | Use |
| --- | --- |
| `chat` | Normal conversation and general help. |
| `oracle` | Workflow setup, task brief, role selection, and process control. |
| `advisor` | High-level opinion, tradeoffs, and second opinions. |
| `judge` | Compare outputs, pick a winner, merge recommendations, or ask the user. |
| `architect` | Plan structure, boundaries, interfaces, and implementation approach. |
| `code` | Build or modify code. |
| `debug` | Diagnose failures and root causes. |
| `test` | Design or write verification checks. |
| `review` | Find bugs, regressions, quality issues, and missing tests. |
| `secure` | Check security risks and unsafe patterns. |
| `verify` | Audit evidence and confirm claims. |
| `devops` | Deployment, CI/CD, environments, and operations. |
| `write` | Documentation and release notes. |
| `ops` | Runbooks, checklists, and process handoffs. |

## Dashboard

Open the dashboard with:

```text
/dash
```

The dashboard shows:

- Head cards with role, model, and activity state
- Recent activity
- Latest responses
- A prompt bar with slash-command autocomplete

Dashboard chat uses the same session transcript system as normal chat, so recent conversation context is included in follow-up messages.

## Orchestration

Hydra can coordinate role-based workflows instead of sending every task to one model.

The current orchestration design is based on:

- `oracle` for intake and process control
- `architect` for solution contracts
- `code` workers for implementation tracks
- `judge` for resolving conflicts and final decisions
- `verify` for evidence checks
- validation roles such as `debug`, `test`, `secure`, `review`, and `devops`

Turn orchestration on with:

```text
/hydra oracle on
/hydra oracle status
```

Run a workflow through Oracle:

```text
/oracle "implement rate limiting for the search endpoint"
```

Hydra creates local workflow artifacts under `.hydra-state/artifacts/`, including task briefs, architecture contracts, ownership maps, decision logs, gate summaries, and implementation notes.

## Local Files

Hydra keeps project and machine-local data in predictable places:

| Path | Purpose |
| --- | --- |
| `.hydra` | Local project memory and decisions, generated per clone. |
| `.hydra-state/` | Local private Hydra state. |
| `.hydra-state/.env` | Private provider keys and local env overrides. |
| `.hydra-state/heads.json` | Configured head registry. |
| `.hydra-state/config.yaml` | Local Hydra settings. |
| `.hydra-state/artifacts/` | Workflow artifacts and lineage. |
| `.hydra-artifacts/` | Reserved for exported deliverables. |

Do not commit real API keys.

## Provider Keys

Hydra reads provider keys from your shell environment or `.hydra-state/.env`.

Common examples:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
OPENROUTER_API_KEY=
```

For OpenAI-compatible providers, use guided setup and provide the base URL when needed.

## Development

Run syntax checks:

```powershell
npm run check
```

Run smoke tests:

```powershell
npm run smoke
```

Start the CLI:

```powershell
npm start
```

## Project Status

Hydra is actively evolving. Core terminal routing, guided setup, dashboard mode, role commands, removable heads, local state, and the first orchestration/artifact slices are implemented. The full-team workflow is being built in thin, testable pieces.
