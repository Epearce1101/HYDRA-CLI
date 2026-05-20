import { BUILTIN_COMMANDS, ROLE_CATEGORIES } from './command-registry.js';

const CATEGORY_ORDER = [
  'Core',
  'Info',
  'General',
  'Thinking',
  'Coding And Engineering',
  'Research And Knowledge',
  'Writing And Communication',
  'Vision And Media',
  'Business',
  'Productivity',
  'Session',
  'System',
  'Admin: Heads',
  'Admin: Auth',
  'Admin: Modes & Routing',
  'Admin: Config & Native',
];

const ADMIN_ENTRIES = [
  // Heads
  { category: 'Admin: Heads', slashForm: '/hydra head list', description: 'List all configured heads with status.', needsPrompt: false },
  { category: 'Admin: Heads', slashForm: '/hydra setup head new', description: 'Add a new head with a guided wizard.', needsPrompt: false },
  { category: 'Admin: Heads', slashForm: '/hydra setup head 1', description: 'Reconfigure head slot 1 with the guided wizard.', needsPrompt: false },
  { category: 'Admin: Heads', slashForm: '/hydra head edit', description: 'Edit head config: model, role, color, base-url, key-env, aliases.', needsPrompt: false, needsArgs: 'edit args (e.g. claude --model opus47)' },
  { category: 'Admin: Heads', slashForm: '/hydra head remove', description: 'Remove a custom head (built-ins not removable).', needsPrompt: false, needsArgs: 'head id to remove' },
  { category: 'Admin: Heads', slashForm: '/hydra head test', description: 'Test a head\'s connection end-to-end.', needsPrompt: false, needsArgs: 'head id to test' },

  // Auth
  { category: 'Admin: Auth', slashForm: '/hydra auth', description: 'Show auth modes for every head.', needsPrompt: false },
  { category: 'Admin: Auth', slashForm: '/hydra auth clear --force', description: 'Clear all saved auth modes.', needsPrompt: false },
  { category: 'Admin: Auth', slashForm: '/hydra accounts', description: 'Show connected provider accounts.', needsPrompt: false },

  // Modes & Routing
  { category: 'Admin: Modes & Routing', slashForm: '/hydra workflow status', description: 'Show workflow mode state.', needsPrompt: false },
  { category: 'Admin: Modes & Routing', slashForm: '/hydra workflow on', description: 'Turn workflow mode on.', needsPrompt: false },
  { category: 'Admin: Modes & Routing', slashForm: '/hydra workflow off', description: 'Turn workflow mode off.', needsPrompt: false },
  { category: 'Admin: Modes & Routing', slashForm: '/hydra mode auto', description: 'Auto routing — broadcast plain prompts to lead.', needsPrompt: false },
  { category: 'Admin: Modes & Routing', slashForm: '/hydra mode workflow', description: 'Workflow routing — chat / code / advisor heads.', needsPrompt: false },
  { category: 'Admin: Modes & Routing', slashForm: '/hydra mode parallel', description: 'Parallel routing — send to all callable heads.', needsPrompt: false },
  { category: 'Admin: Modes & Routing', slashForm: '/hydra lead', description: 'Pick the lead head for plain chat.', needsPrompt: false },
  { category: 'Admin: Modes & Routing', slashForm: '/hydra lead none', description: 'Clear the lead head; plain prompts broadcast.', needsPrompt: false },

  // Config & Native
  { category: 'Admin: Config & Native', slashForm: '/hydra config', description: 'Show current Hydra configuration.', needsPrompt: false },
  { category: 'Admin: Config & Native', slashForm: '/hydra permissions', description: 'Show or change permission level.', needsPrompt: false },
  { category: 'Admin: Config & Native', slashForm: '/hydra budget', description: 'Show or manage usage budget.', needsPrompt: false },
  { category: 'Admin: Config & Native', slashForm: '/hydra memory', description: 'Show or manage Hydra memory.', needsPrompt: false },
  { category: 'Admin: Config & Native', slashForm: '/hydra native claude', description: 'Pass arguments through to the native Claude CLI.', needsPrompt: false, needsArgs: 'claude args (e.g. doctor)' },
  { category: 'Admin: Config & Native', slashForm: '/hydra native codex', description: 'Pass arguments through to the native Codex CLI.', needsPrompt: false, needsArgs: 'codex args (e.g. mcp list)' },
];

export function buildMenuCatalog() {
  const sections = new Map();
  for (const label of CATEGORY_ORDER) {
    sections.set(label, []);
  }

  for (const definition of Object.values(BUILTIN_COMMANDS)) {
    if (definition.aliasFor) continue;
    const bucket = sections.get(definition.category) || ensureBucket(sections, definition.category);
    bucket.push(toEntry(definition, definition.category));
  }

  for (const group of ROLE_CATEGORIES) {
    const bucket = sections.get(group.label) || ensureBucket(sections, group.label);
    for (const definition of group.commands) {
      bucket.push(toEntry(definition, group.label));
    }
  }

  for (const entry of ADMIN_ENTRIES) {
    const bucket = sections.get(entry.category) || ensureBucket(sections, entry.category);
    bucket.push(toAdminEntry(entry));
  }

  return Array.from(sections.entries())
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function toAdminEntry(entry) {
  return Object.freeze({
    name: entry.slashForm.replace(/^\//, '').replace(/\s+/g, '-'),
    type: 'admin',
    description: entry.description,
    slashForm: entry.slashForm,
    usage: entry.slashForm,
    category: entry.category,
    needsPrompt: false,
    needsArgs: entry.needsArgs || null,
  });
}

function ensureBucket(sections, label) {
  const bucket = [];
  sections.set(label, bucket);
  return bucket;
}

function toEntry(definition, category) {
  return Object.freeze({
    name: definition.name,
    type: definition.type,
    description: definition.description || '',
    usage: definition.usage || `/${definition.name}`,
    category,
    needsPrompt: commandNeedsPrompt(definition),
  });
}

function commandNeedsPrompt(definition) {
  if (definition.type === 'role') return true;
  return /"prompt"/i.test(definition.usage || '');
}
