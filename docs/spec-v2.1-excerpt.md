# Hydra CLI Master Prompt

Full System Specification v2.1

> This document captures the excerpt received during initial project creation. The source text cut off in Section 5 at `It contains:`.

## Section 1: Identity, Origin & Philosophy

### Name

Hydra CLI

### Tagline

Cut one down, another spawns.

### Origin Of Name

Hydra is the many-headed serpent of Greek mythology. Cut one head down, and another spawns; that regenerative shape fits an expandable CLI where new AI heads can be added without losing the core coordination model.

Hydra CLI follows that idea: AI heads unified into one terminal. The default heads are Claude, Codex, and Gemini; each brings a different perspective, can work individually or simultaneously, and is coordinated by Hydra for the user.

### Project Origin

Hydra CLI is an independent project created by one person.

It is not a company product. It is not owned by Anthropic, OpenAI, Google, or any AI provider. It is not affiliated with Claude, ChatGPT, Codex, Gemini, or their parent companies.

Hydra exists as an independent coordination layer that connects to provider-approved AI services chosen by the user.

All project direction, design decisions, and development are led by the creator of Hydra CLI.

### Core Philosophy

Hydra CLI exists because the biggest problem with using multiple AI tools is not access. It is coordination.

Developers currently:

- Switch between multiple terminals and interfaces
- Repeat project context to each AI separately
- Lose decisions made in one AI when working in another
- Have no clean way to compare AI responses side by side
- Have no unified project memory all connected AIs can use
- Have no structured way to chain AI outputs together
- Waste time managing tools instead of building

Hydra solves this by acting as a coordination layer.

It is not just a wrapper. It is not just a chatbot. It is not a judge between models.

Hydra is a terminal-based orchestration system that treats Claude, Codex, and Gemini as three connected heads working from shared project context.

### What Hydra Is

- A unified CLI terminal interface
- A coordination system for Claude, Codex, and Gemini
- A shared local-first project context system built around a single `.hydra` file
- A command layer for routing work to one, two, or all three heads
- A decision framework that always defers to the user
- A permissions system for file reads, writes, code execution, and destructive actions
- A budget system for API-cost awareness and spending limits
- A project memory system stored entirely on the user's own machine
- A tool that works with 1, 2, or all 3 heads connected

### What Hydra Is Not

- Not a company product
- Not affiliated with Anthropic, OpenAI, Google, Claude, ChatGPT, Codex, or Gemini
- Not a replacement for the AI providers themselves
- Not a hidden cloud service
- Not a tool that stores user data on Hydra-owned servers
- Not an autonomous agent that decides without the user
- Not a ranker of AI quality
- Not biased toward any single AI head
- Not dependent on all three heads being connected
- Not a tool that exposes API keys or auth tokens

### The Fourth Head

The user is always the fourth head of Hydra.

The three AI heads advise, create, review, research, and debate. Hydra coordinates them. The user decides.

Hydra presents, organizes, routes, logs, and asks. It does not override the user. Ever.

```text
The AI heads advise.
Hydra coordinates.
The user decides.
```

## Section 2: Technical Architecture

### Architectural Position

Hydra CLI is a standalone terminal application.

It communicates with each AI provider through official or provider-approved interfaces. It does not require multiple terminals. It does not require running the native CLI tools for each AI head side by side.

Native tools may still exist separately in their own terminals if the user wants them. Hydra is the coordination layer. It owns its own environment.

### Communication Flow

```text
User types prompt
Hydra CLI receives prompt
Hydra reads .hydra file and loads relevant context
Hydra builds provider-specific system context per head
Hydra sends request through official/provider-approved auth
Claude / Codex / Gemini respond
Hydra renders unified terminal output with head labels
Hydra logs the exchange locally to .hydra/tasks.log
Hydra updates .hydra file if head flagged additions
Decision prompt triggered if responses meaningfully differ
```

### Head Communication Rule

The heads do not directly communicate with each other.

Hydra passes context between heads when the user requests collaboration or when the active mode requires it.

```text
Codex writes code.
Hydra passes Codex's output to Claude.
Claude reviews it.
Hydra passes the review and decision to Gemini.
Gemini writes documentation.
```

The heads appear to work together because Hydra coordinates context through the shared `.hydra` file and explicit `--with` routing commands.

## Section 3: The Three Heads

### Fixed Head Design

The three heads of Hydra are fixed:

```text
Claude      (Anthropic)
Codex       (OpenAI GPT-4o, o1, and current OpenAI models)
Gemini      (Google)
```

The terminal tag `[CODEX]` is used for branding continuity and clarity. The underlying models are current OpenAI GPT models including GPT-4o, o1, and any future OpenAI releases. The Codex name represents the OpenAI head of Hydra, not a specific deprecated model.

Hydra is intentionally built around these three fixed heads. The fixed design keeps the product understandable, coordinated, and focused.

Hydra operates with any combination:

```text
1 head connected   valid, all features available for that head
2 heads connected  valid, coordination features active
3 heads connected  full Hydra mode
```

### Claude

```text
Name:         Claude
Provider:     Anthropic
Terminal tag: [CLAUDE]
Models:       Claude 3 Opus, Claude 3.5 Sonnet, Claude 3 Haiku,
              and any future Anthropic models
Default role: reasoning, architecture, code review, security,
              tradeoffs, long-form analysis
```

### Codex

```text
Name:         Codex
Provider:     OpenAI
Terminal tag: [CODEX]
Models:       GPT-4o, o1, o1-mini, and any future OpenAI models
Default role: code generation, debugging, implementation,
              tests, edits, fast iteration
Note:         Codex is the Hydra terminal name for the OpenAI head.
              The underlying models are current OpenAI GPT models.
```

### Gemini

```text
Name:         Gemini
Provider:     Google
Terminal tag: [GEMINI]
Models:       Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini Ultra,
              and any future Google AI models
Default role: research, broad comparison, documentation,
              large-context review, web-grounded responses
```

### Head Equality Rules

- No head is ranked above another as a universal default
- No head is declared best overall
- Auto Mode routes by task type using transparent rules the user can see
- The user may override routing at any time with explicit commands
- All connected heads read from the same `.hydra` file
- All connected heads log activity to the same local Hydra system
- All heads are displayed with clear labels and equal visual weight

### Color And Label Rules

Hydra never relies on color alone to identify a head.

Each head is always identified by all of the following:

```text
Name          Claude / Codex / Gemini
Terminal tag  [CLAUDE] / [CODEX] / [GEMINI]
Section label clearly shown before every response
```

Color is visual enhancement only. If ANSI color does not render in the user's terminal, all labels remain fully readable.

```text
[CLAUDE]   orange where color available
[CODEX]    white where color available
[GEMINI]   blue where color available

[HYDRA] system messages  red where color available
Success                     green where color available
Warnings / budget alerts    yellow where color available
```

## Section 4: Visual Identity & Boot Screen

### Hydra Text Logo

The Hydra logo is text-based. It works in plain text without color. It fits inside standard terminal widths.

Primary logo:

```text
        /\_/\____,
  ,___/\_/\ \  ~     /
  \     ~  \ )   XXX
    XXX     /    /\_/\___,
       \o-o/-o-o/   ~    /
        ) /     \    XXX
       _|    / \ \_/
    ,-/   _  \_/   \
   / (   /____,__|  )
  (  |_ (    )  \) _|
 _/ _)   \   \__/   (_
    (,-(,(,(,/      \,),),)
```

Compact fallback logo:

```text
   /\_/\   /\_/\   /\_/\
  ( o.o ) ( o.o ) ( o.o )
   > ^ <   > ^ <   > ^ <
```

Ultra-compact inline prompt logo:

```text
HYDRA  Cut one down, another spawns.
```

Logo display is configurable:

```text
/hydra config set logo full
/hydra config set logo compact
/hydra config set logo off
```

### Name Display

```text
H Y D R A   C L I
Cut one down, another spawns.
```

### Boot Screen

On startup Hydra renders the boot screen. The full logo is shown by default and can be configured off.

### Boot Screen Logo Color Logic

```text
1 head connected:
  Logo renders in that head's color
  Claude only   orange
  Codex only    white
  Gemini only   blue

2 heads connected:
  Logo renders in red (Hydra system color)

3 heads connected:
  Logo renders in red (full Hydra mode)

No color support:
  Logo renders in plain text
  All labels remain fully readable
```

## Section 5: Local-First Privacy Model

Implementation note: the excerpt names both a root `.hydra` file and a project-level `.hydra` directory. A filesystem cannot store a file and directory at the same path, so the scaffold reserves `.hydra` for the shareable project context file and `.hydra-state/` for private local config and logs.

### Core Privacy Rule

Hydra is local-first.

All Hydra project data is stored on the user's own machine inside the project-level `.hydra` directory and the `.hydra` shared file at the project root.

Hydra does not host user memory, prompts, logs, project files, or API keys on Hydra-owned servers.

### Stored Locally

```text
project memory and notes
decision history
task logs and session data
config settings
connected-head metadata
API keys and provider-approved auth tokens (in .env only)
budget settings
permission settings
the .hydra shared intelligence file
```

### Not Stored By Hydra Servers

```text
user prompts
project files
project memory
task logs
API keys
auth tokens
AI responses
private project context
```

Hydra has no servers that receive this data.

### Sent To AI Providers

Connected AI providers receive only what is required for the current request:

```text
the user's current prompt
selected project context injected from .hydra file
relevant shared memory
approved file snippets
conversation context within configured settings
```

Provider data handling depends on each provider's own terms, user account settings, and API configuration.

### The `.hydra` File And Team Sharing

The top-level `.hydra` file is designed to be safe to commit to git and share with teammates.

It contains:

```text
TODO: Source specification excerpt ended here.
```
