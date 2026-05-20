# Hydra CLI Commands

Hydra supports short root slash commands and the longer `/hydra ...` commands.

Command resolution order:

1. Built-in command
2. Role command
3. Nickname or alias
4. Direct head name
5. Unknown command suggestion

Built-ins always win over nicknames. Reserved command names cannot be used as active nicknames.

## Core

| Command | What it does |
| --- | --- |
| `/` or `/menu` | Opens the interactive command picker. Type to filter, Up/Down to move, Enter to pick, Esc to cancel. If the picked command needs a prompt, it asks for one inline. |
| `/help` | Shows the command guide. |
| `/status` | Shows current Hydra status, heads, mode, budget, permissions, and session count. |
| `/setup` | Starts guided setup. |
| `/setup head 1` | Guided setup for a specific head slot. Uses arrow-key menus for provider, live provider model lists grouped by free/paid and sorted alphabetically, role, prompt style, setup style, and API-key choices. |
| `/setup head new` | Guided setup for a new head. Starts with the provider menu instead of asking for a raw head id. |
| `/remove head 4` | Removes any configured head by visible slot number. |
| `/doctor` | Runs Hydra health checks. |
| `/exit` | Exits interactive mode. |
| `/quit` | Alias for `/exit`. |

## Info

| Command | What it does |
| --- | --- |
| `/heads` | Shows configured heads, roles, nicknames, provider/model, and callable state. |
| `/roles` | Shows all role commands grouped by category. |
| `/roles clear head 1` | Clears the assigned role for one head slot. |
| `/roles clear all` | Clears assigned roles for every configured head. |
| `/nicknames` | Shows head nicknames and aliases. |
| `/who <command>` | Explains what a command routes to. |

Examples:

```text
/who advisor
/who code
/who head1
```

## General

| Command | What it does |
| --- | --- |
| `/ask "prompt"` | Sends a normal prompt using Hydra default routing. |
| `/chat "prompt"` | Routes casual chat to the configured chat/default head. |
| `/fast "prompt"` | Uses the configured fast/speed head or the fastest known fallback. |
| `/all "prompt"` | Sends the prompt to all callable heads and groups responses by head. |

## Thinking

| Command | What it does |
| --- | --- |
| `/advisor "prompt"` | Strategy, planning, second opinions, and decisions. |
| `/architect "prompt"` | Designs structure, boundaries, interfaces, and tradeoffs for complex solutions. |
| `/plan "prompt"` | Creates a step-by-step plan or roadmap. |
| `/critic "prompt"` | Finds weak spots, risks, flaws, assumptions, and edge cases. |
| `/judge "prompt"` | Compares options and recommends the best one. |
| `/explain "prompt"` | Explains something clearly and simply. |
| `/summary "prompt"` | Summarizes content or ideas. |

## Coding And Engineering

| Command | What it does |
| --- | --- |
| `/code "prompt"` | Builds or edits code. |
| `/debug "prompt"` | Helps fix errors, crashes, logs, stack traces, and broken behavior. |
| `/test "prompt"` | Writes tests, checks behavior, creates test plans, or validates behavior. |
| `/review "prompt"` | Reviews code, docs, plans, pull requests, architecture, or implementation choices. |
| `/secure "prompt"` | Checks for security risks, exposed secrets, unsafe patterns, and vulnerabilities. |
| `/devops "prompt"` | Helps with deployment, Docker, CI/CD, automation, environments, and infrastructure. |

## Research And Knowledge

| Command | What it does |
| --- | --- |
| `/research "prompt"` | Researches a topic, compares options, or gathers context. |
| `/verify "prompt"` | Fact-checks claims and validates information. |
| `/teach "prompt"` | Teaches or tutors a concept. |
| `/library "prompt"` | Organizes notes, references, files, knowledge bases, or saved information. |

## Writing And Communication

| Command | What it does |
| --- | --- |
| `/write "prompt"` | Drafts text, docs, README sections, notes, or explanations. |
| `/edit "prompt"` | Rewrites, polishes, shortens, improves, or changes tone. |
| `/copy "prompt"` | Writes marketing copy, taglines, ads, landing page text, or launch copy. |
| `/email "prompt"` | Writes or replies to emails. |
| `/translate "prompt"` | Translates text. |

## Vision And Media

| Command | What it does |
| --- | --- |
| `/vision "prompt"` | Analyzes images, screenshots, diagrams, charts, UI screenshots, or visual content. |
| `/design "prompt"` | Helps with UI, layout, branding, design direction, visual style, and polish. |
| `/ocr "prompt"` | Extracts text from images, screenshots, receipts, documents, or diagrams. |
| `/artist "prompt"` | Helps with image prompts, art direction, visual concepts, and creative visuals. |
| `/video "prompt"` | Helps with video ideas, scripts, shot lists, scenes, editing plans, hooks, or storyboards. |
| `/audio "prompt"` | Helps with audio, voice, sound ideas, podcast planning, scripts, or music direction. |

If no media-capable head is configured, `/vision` and `/ocr` show a clear routing error.

## Business

| Command | What it does |
| --- | --- |
| `/accountant "prompt"` | Organizes expenses, invoices, budgets, receipts, categories, and money records. Assistive only. |
| `/finance "prompt"` | Helps with financial analysis, pricing, projections, estimates, and planning. Assistive only. |
| `/analyst "prompt"` | Analyzes data, business ideas, trends, reports, metrics, or decisions. |
| `/ops "prompt"` | Creates workflows, SOPs, checklists, process improvements, and operations plans. |
| `/market "prompt"` | Helps with marketing ideas, positioning, campaigns, launches, targeting, and messaging. |
| `/sales "prompt"` | Writes sales copy, pitches, outreach, objection responses, and follow-ups. |
| `/support "prompt"` | Helps with customer support replies, triage, help docs, FAQs, and issue responses. |

## Productivity

| Command | What it does |
| --- | --- |
| `/assistant "prompt"` | General assistant tasks. |
| `/schedule "prompt"` | Helps plan time, calendars, routines, deadlines, and schedules. |
| `/organize "prompt"` | Organizes messy lists, priorities, files, notes, or tasks. |
| `/coach "prompt"` | Helps with goals, habits, planning, accountability, and progress. |
| `/negotiate "prompt"` | Helps with tradeoffs, difficult conversations, negotiation scripts, and decision framing. |

## Session

| Command | What it does |
| --- | --- |
| `/resume` | Resumes the last saved session. |
| `/resume <name>` | Resumes a named session from `.hydra-state/sessions/`. |
| `/clear` | Clears the current session/context after confirmation when needed. |
| `/compact` | Compresses the current session into a shorter local recap. |
| `/fork` | Saves a named branch snapshot of the current session. |
| `/side "prompt"` | Runs a side task without saving it into the main session context. |
| `/reset` | Alias for `/clear`. |
| `/summarize` | Alias for `/compact`. |

## System

| Command | What it does |
| --- | --- |
| `/permissions` | Shows or changes permission level. |
| `/budget` | Shows or manages usage budget. |
| `/memory` | Shows or manages saved Hydra memory. |
| `/models` | Shows configured models. |
| `/accounts` | Shows connected provider auth/account state. |
| `/providers` | Shows supported providers. |

## Long-Form Commands

Existing longer commands still work, including:

```text
/hydra commands
/hydra head list
/hydra auth
/hydra workflow on
/hydra native claude --help
/hydra native codex exec --help
```

Legacy convenience aliases still work:

```text
/advise "prompt"
/wf
/wf on
/wf off
/lead <head-id>
/lead none
```
