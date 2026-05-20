# Hydra CLI Command Reference

All interactive commands live under the `/hydra` namespace.

While typing in interactive mode, Hydra shows matching commands below the prompt. Suggestions are red where terminal color is available. Use `Up` and `Down` to move through matches, `Tab` to insert the highlighted command, and `Enter` to run the input. When the input exactly matches a known command, the suggestion list disappears and the prompt command turns red. Matching is case-insensitive, so caps lock still works.

Simple, low-risk shorthand commands are available for frequent actions. Complex or powerful commands stay under `/hydra`.

```text
/chat "prompt"       Gemini chat
/code "prompt"       Codex code role
/advise "prompt"     Claude advisor Opus
/wf                  Workflow status
/wf on               Workflow on
/wf off              Workflow off
/lead codex          Set plain-prompt lead
/status              Status
/heads               Head list
```

Useful namespaced shortcuts are also available when you want the command to stay under `/hydra`:

```text
/hydra advisor "prompt"                 Claude advisor Opus
/hydra advisor sonnet "prompt"          Claude advisor Sonnet
/hydra advisor --with codex "prompt"    Advisor with Codex context
```

Native provider commands, auth, permissions, budget, memory clearing, and other administrative actions intentionally stay explicit under `/hydra`.

## Core

```text
/hydra help
/hydra commands
/hydra complete "/hydra claude adv"
/hydra status
/hydra doctor
/hydra heads
/hydra native claude --help
/hydra native codex exec --help
/hydra exit
```

- `help` prints command help.
- `commands` prints the full grouped command list.
- `complete` prints command suggestions for a typed prefix. Interactive suggestions use the same catalog.
- `status` prints mode, connected heads, budget status, and permission level.
- `doctor` checks project files, provider connectivity, and budget status.
- `heads` prints the fixed Claude, Codex, and Gemini definitions.
- `native` runs installed Claude Code or Codex CLI commands directly from the Hydra project root.
- `exit` closes the interactive session.

## Native CLI Passthrough

```text
/hydra native claude --help
/hydra native claude doctor
/hydra native claude mcp list
/hydra native codex --help
/hydra native codex exec --help
/hydra native codex mcp list
/hydra claude-code --help
/hydra codex-cli --help
```

Use `native` when you need an installed Claude Code or Codex CLI command that Hydra does not wrap directly. Hydra runs the provider CLI from the project root using `HYDRA_CLAUDE_BIN` or `HYDRA_CODEX_BIN` when configured.

The same passthrough works outside interactive mode:

```powershell
hydra native claude --help
hydra native codex exec --help
hydra claude-code doctor
hydra codex-cli --version
```

## Head Tool Access

When a head supports Hydra tool calling, it receives a `run_native_cli` tool. That lets any API-backed head run Claude Code or Codex CLI commands with approval through Hydra permissions:

```text
run_native_cli provider=claude args=["doctor"]
run_native_cli provider=codex args=["mcp", "list"]
run_native_cli provider=codex prompt="Review this implementation."
```

Subscription Claude and Codex heads run inside their native CLIs. Hydra injects the same bridge command into their context, so they can use their own CLI tooling to run:

```text
hydra native claude ...
hydra native codex ...
```

## Setup And Auth

```text
/hydra setup
/hydra auth
/hydra auth claude auto
/hydra auth claude api-key
/hydra auth claude subscription
/hydra auth claude off
/hydra auth clear --force
```

Use `setup` for guided configuration. Use `auth` for direct mode changes.

Auth modes:

- `auto`: use API key mode when a key exists, otherwise not connected.
- `api-key`: call the official provider SDK using the configured API key.
- `subscription`: show the head as connected and unmetered, but keep SDK calls disabled unless a compliant provider interface exists.
- `off`: disable the head.

`auth clear --force` asks for confirmation and then sets all saved auth modes to `off`. It does not delete private keys.

## Modes And Routing

```text
/hydra mode auto
/hydra mode solo claude
/hydra mode solo codex
/hydra mode solo gemini
/hydra mode parallel
/hydra mode workflow
/hydra workflow on
/hydra workflow off
/hydra workflow status
/hydra all "prompt"
/hydra advisor "prompt"
/hydra advisor sonnet "prompt"
/hydra advisor --with codex "prompt"
/hydra claude "prompt"
/hydra codex "prompt"
/hydra gemini "prompt"
/hydra claude --with codex "prompt"
/hydra claude advisor opus "prompt"
/hydra codex code gpt55 "prompt"
/hydra gemini research pro "prompt"
```

- `auto` routes using Hydra default behavior.
- `solo` sends prompts to one head.
- `parallel` sends prompts to all connected callable heads.
- `workflow` enables the default three-head workflow: normal chat routes to Gemini; coding prompts route to Codex with the `code` role and then Claude with the `advisor` role using Codex's response as context.
- `all` is explicit parallel mode.
- `advisor` is the useful short form for `/hydra claude advisor opus`; it accepts Claude model aliases before the prompt and supports `--with`.
- `--with` injects one head's last full response into another head's context.

Workflow shortcut:

```text
/hydra workflow on
/hydra workflow off
/hydra workflow status
```

The default workflow is:

```text
Normal chat: Gemini
Coding:      Codex code
Advisor:     Claude advisor
```

Provider command syntax:

```text
/hydra <head> [role] [model] "prompt"
/hydra <head> [role] [model]
```

If a prompt is provided, the role/model applies to that single request. If no prompt is provided, Hydra saves the role/model as that head's default in `.hydra-state/config.yaml`.

Roles:

```text
advisor architect chat plan critic judge explain summary code debug test review secure devops research verify teach library write edit copy email translate vision design ocr artist video audio accountant finance analyst ops market sales support assistant schedule organize coach negotiate
```

Model aliases:

```text
Claude: opus opus47 opus41 opus4 sonnet sonnet4 sonnet37 haiku haiku35
Codex:  latest gpt55 gpt54 mini nano gpt5 gpt4o o3
Gemini: pro pro3 flash flash25 lite flashlite pro25
```

Full provider model IDs are also accepted when they match the provider prefix, such as `claude-sonnet-4-20250514`, `gpt-5.5`, or `gemini-2.5-flash`.

The legacy `ask` command remains available:

```text
hydra ask --with codex "prompt"
hydra ask --with all "prompt"
```

## Memory

```text
/hydra memory
/hydra memory add "note"
/hydra memory clear --force
```

Memory is stored in the root `.hydra` file. Writes are append-only. Clearing memory appends a clear marker and makes Hydra ignore earlier memory entries.

## Decisions

```text
/hydra decide
/hydra decide history
/hydra decide revisit dec_001
```

`decide` reopens the most recent pending or parallel decision. `history` lists decisions from `.hydra`. `revisit` reloads stored task responses for a previous decision when available.

## Budget

```text
/hydra budget
/hydra budget ON--$5.00
/hydra budget OFF
/hydra budget status
/hydra budget add --$2.00
/hydra budget set --$10.00
/hydra budget reset
/hydra budget alert 80
```

Budget tracks estimated API usage for metered API-key heads. Subscription heads are treated as unmetered when subscription exclusion is enabled.

## Permissions

```text
/hydra permissions
/hydra permissions strict
/hydra permissions default
/hydra permissions trust
/hydra permissions full
/hydra permissions 0
/hydra permissions 1
/hydra permissions 2
/hydra permissions 3
/hydra permissions reset
/hydra permissions-all
/hydra permissions-all --save
```

Permission levels:

- `0` strict: ask before every action.
- `1` default: read freely within project scope, ask before writes and execution.
- `2` trust: read and write within project scope, ask before execution.
- `3` full: read, write, and execute within project scope, still ask for high-risk actions.

Scoped grants:

```text
/hydra allow writes 10m
/hydra allow writes this-session
/hydra allow path ./src
/hydra allow command "npm test"
/hydra deny shell
```

## Config

```text
/hydra config
/hydra config set logo full
/hydra config set logo compact
/hydra config set logo off
```

Config is stored in `.hydra-state/config.yaml`.
