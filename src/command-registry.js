import { HEAD_ROLES } from './provider-commands.js';

export const BUILTIN_COMMANDS = Object.freeze({
  help: command('help', 'Core', 'Shows help and examples.', '/help'),
  status: command('status', 'Core', 'Shows current Hydra status.', '/status'),
  setup: command('setup', 'Core', 'Starts guided setup.', '/setup [head <slot|new>]'),
  remove: command('remove', 'Core', 'Removes a custom head by visible slot or id.', '/remove head <slot|id>'),
  doctor: command('doctor', 'Core', 'Runs health checks.', '/doctor'),
  dashboard: command('dashboard', 'Core', 'Opens the live multi-head dashboard. Press Esc, Ctrl+C, or Ctrl+D to close.', '/dashboard'),
  dash: command('dash', 'Core', 'Alias for /dashboard.', '/dash', { aliasFor: 'dashboard' }),
  exit: command('exit', 'Core', 'Exits interactive mode.', '/exit'),
  quit: command('quit', 'Core', 'Alias for /exit.', '/quit', { aliasFor: 'exit' }),
  heads: command('heads', 'Info', 'Shows configured heads.', '/heads'),
  roles: command('roles', 'Info', 'Shows role commands grouped by category or clears assigned roles.', '/roles [clear head <n>|clear all]'),
  nicknames: command('nicknames', 'Info', 'Shows configured nicknames and aliases.', '/nicknames'),
  who: command('who', 'Info', 'Explains where a command routes.', '/who <command>'),
  resume: command('resume', 'Session', 'Resumes the last or named saved session.', '/resume [name]'),
  clear: command('clear', 'Session', 'Clears current session/context.', '/clear'),
  reset: command('reset', 'Session', 'Alias for /clear.', '/reset', { aliasFor: 'clear' }),
  compact: command('compact', 'Session', 'Compacts the current session context.', '/compact'),
  summarize: command('summarize', 'Session', 'Alias for /compact.', '/summarize', { aliasFor: 'compact' }),
  fork: command('fork', 'Session', 'Creates a branch snapshot of the current session.', '/fork'),
  side: command('side', 'Session', 'Runs a side task without saving it into main context.', '/side "prompt"'),
  permissions: command('permissions', 'System', 'Shows or changes permission level.', '/permissions [level]'),
  budget: command('budget', 'System', 'Shows or manages usage budget.', '/budget'),
  memory: command('memory', 'System', 'Shows or manages Hydra memory.', '/memory'),
  models: command('models', 'System', 'Shows configured models.', '/models'),
  accounts: command('accounts', 'System', 'Shows connected provider account/auth modes.', '/accounts'),
  providers: command('providers', 'System', 'Shows supported providers.', '/providers'),
});

export const ROLE_CATEGORIES = Object.freeze([
  category('General', [
    role('ask', 'Sends a normal prompt using Hydra default routing.', { routeMode: 'default' }),
    role('chat', 'General chat or casual questions.', { defaultHead: 'gemini' }),
    role('fast', 'Quick answer using the fastest configured head.', { defaultHead: 'codex', routeMode: 'fast' }),
    role('all', 'Sends the prompt to all callable heads.', { routeMode: 'all' }),
  ]),
  category('Orchestration', [
    role('oracle', 'Owns workflow setup and integration. Inspects roles, creates task briefs, routes conflicts to judge.', { defaultHead: 'claude', roleKey: 'oracle' }),
    role('spec', 'Clarifies requirements and acceptance criteria before design.', { defaultHead: 'claude', roleKey: 'spec' }),
  ]),
  category('Thinking', [
    role('advisor', 'Strategy, planning, second opinions, and decisions.', { defaultHead: 'claude', roleKey: 'advisor', modelAlias: 'opus' }),
    role('architect', 'Designs structure, boundaries, interfaces, and tradeoffs for complex solutions.', { defaultHead: 'claude', roleKey: 'architect' }),
    role('plan', 'Creates a step-by-step plan or roadmap.', { defaultHead: 'claude', roleKey: 'plan' }),
    role('critic', 'Finds weak spots, risks, flaws, bad assumptions, and edge cases.', { defaultHead: 'claude', roleKey: 'critic' }),
    role('judge', 'Compares options and recommends the best one.', { defaultHead: 'claude', roleKey: 'judge' }),
    role('explain', 'Explains something clearly and simply.', { defaultHead: 'claude', roleKey: 'explain' }),
    role('summary', 'Summarizes content or ideas.', { defaultHead: 'gemini', roleKey: 'summary' }),
  ]),
  category('Coding And Engineering', [
    role('code', 'Builds or edits code.', { defaultHead: 'codex', roleKey: 'code' }),
    role('debug', 'Helps fix errors, crashes, logs, stack traces, and broken behavior.', { defaultHead: 'codex', roleKey: 'debug' }),
    role('test', 'Writes tests, checks behavior, creates test plans, or validates expected behavior.', { defaultHead: 'codex', roleKey: 'test' }),
    role('review', 'Reviews code, docs, plans, architecture, or implementation choices.', { defaultHead: 'claude', roleKey: 'review' }),
    role('secure', 'Checks for security risks, exposed secrets, unsafe patterns, and vulnerabilities.', { defaultHead: 'claude', roleKey: 'secure' }),
    role('devops', 'Helps with deployment, Docker, CI/CD, automation, environments, and infrastructure.', { defaultHead: 'codex', roleKey: 'devops' }),
  ]),
  category('Research And Knowledge', [
    role('research', 'Researches a topic, compares options, or gathers broader context.', { defaultHead: 'gemini', roleKey: 'research' }),
    role('verify', 'Fact-checks claims, checks consistency, and validates information.', { defaultHead: 'gemini', roleKey: 'verify' }),
    role('teach', 'Teaches or tutors a concept.', { defaultHead: 'gemini', roleKey: 'teach' }),
    role('library', 'Organizes notes, references, files, knowledge bases, or saved information.', { defaultHead: 'gemini', roleKey: 'library' }),
  ]),
  category('Writing And Communication', [
    role('write', 'Drafts text, docs, README sections, content, notes, or explanations.', { defaultHead: 'claude', roleKey: 'write' }),
    role('edit', 'Rewrites, polishes, shortens, improves, or changes tone.', { defaultHead: 'claude', roleKey: 'edit' }),
    role('copy', 'Writes marketing copy, taglines, ads, landing text, launch copy, or promos.', { defaultHead: 'claude', roleKey: 'copy' }),
    role('email', 'Writes or replies to emails.', { defaultHead: 'claude', roleKey: 'email' }),
    role('translate', 'Translates text.', { defaultHead: 'gemini', roleKey: 'translate' }),
  ]),
  category('Vision And Media', [
    role('vision', 'Analyzes images, screenshots, diagrams, charts, UI screenshots, or visual content.', { roleKey: 'vision', requiresMediaHead: true }),
    role('design', 'Helps with UI, layout, branding, design direction, visual style, and polish.', { defaultHead: 'claude', roleKey: 'design' }),
    role('ocr', 'Extracts text from images, screenshots, receipts, documents, or diagrams.', { roleKey: 'ocr', requiresMediaHead: true }),
    role('artist', 'Helps with image prompts, art direction, visual concepts, and creative visuals.', { defaultHead: 'claude', roleKey: 'artist' }),
    role('video', 'Helps with video ideas, scripts, shot lists, scenes, editing plans, hooks, or storyboards.', { defaultHead: 'claude', roleKey: 'video' }),
    role('audio', 'Helps with audio, voice, sound ideas, podcast planning, scripts, or music direction.', { defaultHead: 'claude', roleKey: 'audio' }),
  ]),
  category('Business', [
    role('accountant', 'Organizes expenses, invoices, budgets, receipts, categories, and money records.', { defaultHead: 'gemini', roleKey: 'accountant' }),
    role('finance', 'Helps with financial analysis, pricing, projections, estimates, and cost breakdowns.', { defaultHead: 'gemini', roleKey: 'finance' }),
    role('analyst', 'Analyzes data, business ideas, trends, reports, metrics, or decisions.', { defaultHead: 'gemini', roleKey: 'analyst' }),
    role('ops', 'Creates workflows, SOPs, checklists, process improvements, and operations plans.', { defaultHead: 'claude', roleKey: 'ops' }),
    role('market', 'Helps with marketing ideas, positioning, campaigns, launches, targeting, and messaging.', { defaultHead: 'claude', roleKey: 'market' }),
    role('sales', 'Writes sales copy, pitches, outreach, objection responses, and follow-ups.', { defaultHead: 'claude', roleKey: 'sales' }),
    role('support', 'Helps with customer support replies, triage, help docs, FAQs, and issue responses.', { defaultHead: 'claude', roleKey: 'support' }),
  ]),
  category('Productivity', [
    role('assistant', 'General assistant tasks.', { defaultHead: 'gemini', roleKey: 'assistant' }),
    role('schedule', 'Helps plan time, calendars, routines, deadlines, and schedules.', { defaultHead: 'gemini', roleKey: 'schedule' }),
    role('organize', 'Organizes messy lists, priorities, files, notes, or tasks.', { defaultHead: 'gemini', roleKey: 'organize' }),
    role('coach', 'Helps with goals, habits, motivation, planning, accountability, and progress.', { defaultHead: 'claude', roleKey: 'coach' }),
    role('negotiate', 'Helps with tradeoffs, difficult conversations, negotiation scripts, and decision framing.', { defaultHead: 'claude', roleKey: 'negotiate' }),
  ]),
]);

export const ROLE_COMMANDS = Object.freeze(Object.fromEntries(
  ROLE_CATEGORIES.flatMap((group) => group.commands.map((definition) => [definition.name, definition])),
));

export const RESERVED_COMMAND_NAMES = Object.freeze(new Set([
  ...Object.keys(BUILTIN_COMMANDS),
  ...Object.keys(ROLE_COMMANDS),
]));

export function normalizeCommandName(value) {
  return String(value || '').trim().replace(/^\/+/, '').toLowerCase();
}

export function isReservedCommandName(value) {
  return RESERVED_COMMAND_NAMES.has(normalizeCommandName(value));
}

export function getReservedCommandNames() {
  return Array.from(RESERVED_COMMAND_NAMES).sort();
}

export function getCommandSuggestions(value, limit = 5) {
  const target = normalizeCommandName(value);
  if (!target) return [];
  const known = [
    ...Object.keys(BUILTIN_COMMANDS),
    ...Object.keys(ROLE_COMMANDS),
  ];
  return known
    .map((name) => ({ name, score: stringDistance(target, name) }))
    .filter((entry) => entry.score <= Math.max(2, Math.ceil(target.length / 3)))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => entry.name);
}

export function getNicknameEntries(heads = []) {
  return heads.flatMap((head, index) => {
    const configured = normalizeAliases([
      ...(Array.isArray(head.aliases) ? head.aliases : []),
      ...(Array.isArray(head.nicknames) ? head.nicknames : []),
      head.nickname,
    ]);
    const ordinal = `head${index + 1}`;
    const aliases = Array.from(new Set([ordinal, ...configured]));
    return aliases
      .filter((alias) => alias && alias !== head.id)
      .map((alias) => ({
        alias,
        head,
        source: alias === ordinal ? 'ordinal' : 'configured',
        reserved: isReservedCommandName(alias),
      }));
  });
}

export function resolveCommandName(input, heads = []) {
  const name = normalizeCommandName(input);
  if (!name) {
    return { type: 'empty', command: name };
  }

  const builtin = BUILTIN_COMMANDS[name];
  if (builtin) {
    return { type: 'builtin', command: name, definition: builtin };
  }

  const roleDefinition = ROLE_COMMANDS[name];
  if (roleDefinition) {
    return { type: 'role', command: name, definition: roleDefinition };
  }

  const nickname = getNicknameEntries(heads).find((entry) => !entry.reserved && entry.alias === name);
  if (nickname) {
    return { type: 'nickname', command: name, head: nickname.head, nickname };
  }

  const direct = heads.find((head) => (
    normalizeCommandName(head.id) === name
    || normalizeCommandName(head.name) === name
  ));
  if (direct) {
    return { type: 'head', command: name, head: direct };
  }

  return {
    type: 'unknown',
    command: name,
    suggestions: getCommandSuggestions(name),
  };
}

export function commandUsage(definition) {
  if (!definition) return '';
  if (definition.usage) return definition.usage;
  if (definition.type === 'role') return `/${definition.name} "prompt"`;
  return `/${definition.name}`;
}

export function commandExample(definition) {
  if (!definition) return '';
  if (definition.example) return definition.example;
  if (definition.type === 'role') return `/${definition.name} "Help me with this"`;
  return commandUsage(definition);
}

export function roleInstructionFor(commandName) {
  const roleDefinition = ROLE_COMMANDS[normalizeCommandName(commandName)];
  if (!roleDefinition?.roleKey) return '';
  return HEAD_ROLES[roleDefinition.roleKey]?.instruction || roleDefinition.description || '';
}

function command(name, category, description, usage, extra = {}) {
  return Object.freeze({
    type: 'builtin',
    name,
    category,
    description,
    usage,
    ...extra,
  });
}

function role(name, description, extra = {}) {
  return Object.freeze({
    type: 'role',
    name,
    description,
    usage: `/${name} "prompt"`,
    example: `/${name} "Help me with this"`,
    roleKey: name,
    ...extra,
  });
}

function category(label, commands) {
  return Object.freeze({
    label,
    commands: Object.freeze(commands),
  });
}

function normalizeAliases(values) {
  return values
    .filter((value) => typeof value === 'string' && value.trim())
    .map(normalizeCommandName);
}

function stringDistance(left, right) {
  const a = String(left);
  const b = String(right);
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}
