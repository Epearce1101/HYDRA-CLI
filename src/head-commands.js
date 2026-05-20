import { systemLine } from './logo.js';
import { printHeadStatusBlock, subscriptionStatusDetail } from './head-display.js';
import {
  addHeadToRegistry,
  detectConnectedHeads,
  getHead,
  getHeadCap,
  listHeads,
  removeHeadFromRegistry,
  updateHeadInRegistry,
} from './heads.js';
import { getProvider, listProviders } from './providers.js';
import { invalidateHealth, verifyHead } from './health.js';
import { updateProjectConfig, writeTaskLog } from './project.js';

export function parseHeadFlags(tokens) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

export async function handleHeadCommand(tokens, ask) {
  const action = (tokens[0] || 'list').toLowerCase();
  const rest = tokens.slice(1);

  if (action === 'list' || action === 'ls') {
    handleHeadListCommand();
    return;
  }
  if (action === 'add') {
    await handleHeadAddCommand(rest, ask);
    return;
  }
  if (action === 'remove' || action === 'rm') {
    await handleHeadRemoveCommand(rest, ask);
    return;
  }
  if (action === 'edit' || action === 'update') {
    await handleHeadEditCommand(rest);
    return;
  }
  if (action === 'test') {
    await handleHeadTestCommand(rest);
    return;
  }

  console.log(systemLine('Usage:', 'yellow'));
  console.log('  /hydra head list');
  console.log('  /hydra head add <id> --provider <openai|anthropic|google-gemini|openai-compat> [--key-env VAR] [--model X] [--base-url URL] [--name X] [--tag "[X]"] [--color X] [--role X] [--aliases a,b] [--force]');
  console.log('  /hydra head edit <id> [--model X] [--role X] [--base-url URL] [--key-env VAR] [--name X] [--tag "[X]"] [--color X] [--aliases a,b]');
  console.log('  /hydra head remove <id>');
  console.log('  /hydra head test <id>');
}

export function handleHeadListCommand() {
  const heads = detectConnectedHeads();
  console.log('[HYDRA] HEADS');
  console.log('');
  heads.forEach((head, index) => {
    printHeadStatusBlock(head, index);
    if (head.baseUrl) console.log(`    Base URL: ${head.baseUrl}`);
    if (head.envKey) console.log(`    Env key:  ${head.envKey}`);
    console.log('');
  });
}

export async function handleHeadAddCommand(tokens, ask) {
  const { positional, flags } = parseHeadFlags(tokens);
  const id = (positional[0] || '').toLowerCase();
  if (!id || !/^[a-z][a-z0-9_-]*$/.test(id)) {
    console.log(systemLine('Head id must be lowercase alphanumeric (start with letter, allow - and _).', 'yellow'));
    return;
  }
  if (getHead(id)) {
    console.log(systemLine(`Head "${id}" already exists. Use /hydra head edit ${id} ... to change it.`, 'yellow'));
    return;
  }

  const providerArg = (flags.provider || '').toLowerCase();
  const providerAliases = { 'openai-compat': 'openai', gemini: 'google-gemini', google: 'google-gemini' };
  const providerId = providerAliases[providerArg] || providerArg;
  const provider = getProvider(providerId);
  if (!provider) {
    console.log(systemLine(`Unknown provider "${flags.provider || '(missing)'}". Expected: ${listProviders().map((p) => p.id).join(', ')}, or openai-compat.`, 'yellow'));
    return;
  }
  if (provider.auth === 'subscription') {
    console.log(systemLine(`Provider "${providerId}" is subscription-only and is wired to its built-in head. Custom subscription heads are not supported.`, 'yellow'));
    return;
  }

  const current = listHeads();
  const cap = getHeadCap();
  if (current.length >= cap && flags.force !== true) {
    console.log(systemLine(`Adding head would exceed soft cap of ${cap}. UI may not render cleanly above this. Re-run with --force to proceed.`, 'yellow'));
    return;
  }
  if (current.length >= cap && flags.force === true) {
    console.log(systemLine(`Proceeding past head cap (${cap}). UI may not render cleanly.`, 'yellow'));
  }

  const envKey = flags['key-env'] || flags['env-key'] || provider.defaultEnvKey;
  if (!envKey) {
    console.log(systemLine(`Provider "${providerId}" needs an env-var name. Pass --key-env <VAR>.`, 'yellow'));
    return;
  }

  if (flags.color) {
    const colorClash = current.find((h) => h.color === flags.color);
    if (colorClash) {
      console.log(systemLine(`Note: color "${flags.color}" is already used by "${colorClash.id}". Continuing.`, 'yellow'));
    }
  }

  const head = {
    id,
    name: flags.name || (id.charAt(0).toUpperCase() + id.slice(1)),
    tag: flags.tag || `[${id.toUpperCase()}]`,
    color: flags.color || null,
    providerId,
    envKey,
    defaultModel: flags.model || null,
    defaultRole: flags.role || null,
    aliases: flags.aliases || flags.alias || flags.nickname || [],
    baseUrl: flags['base-url'] || null,
    builtin: false,
  };

  try {
    const created = addHeadToRegistry(head);
    writeTaskLog({ type: 'head.added', head: created.id, providerId: created.providerId });
    console.log(systemLine(`Head "${created.id}" added (provider: ${created.providerId}).`, 'green'));
    console.log(`  tag:      ${created.tag}`);
    console.log(`  color:    ${created.color}`);
    console.log(`  env_key:  ${created.envKey}`);
    if (created.baseUrl) console.log(`  base_url: ${created.baseUrl}`);
    if (created.defaultModel) console.log(`  model:    ${created.defaultModel}`);
    if (!process.env[created.envKey]) {
      console.log('');
      console.log(systemLine(`Reminder: set ${created.envKey} in your shell or .hydra-state/.env to make this head callable.`, 'yellow'));
    }
    console.log(systemLine('Run /hydra head test ' + created.id + ' to verify.', 'green'));
  } catch (error) {
    console.log(systemLine(`Failed to add head: ${error.message}`, 'yellow'));
  }
}

export async function handleHeadRemoveCommand(tokens, ask) {
  const selectors = parseRemoveSelectors(tokens);
  if (!selectors.length) {
    console.log(systemLine('Usage: /hydra head remove <id> | /hydra head remove head <slot>', 'yellow'));
    return;
  }

  const heads = listHeads();
  const targets = [];
  for (const selector of selectors) {
    const head = resolveRemoveSelector(selector, heads);
    if (!head) {
      console.log(systemLine(`No head "${selector}" registered. Use /heads to list configured heads.`, 'yellow'));
      return;
    }
    if (!targets.some((target) => target.id === head.id)) {
      targets.push(head);
    }
  }

  for (const existing of targets) {
    await removeOneHead(existing, ask);
  }
}

function parseRemoveSelectors(tokens) {
  const parts = Array.isArray(tokens) ? tokens.map(String) : [];
  const selected = parts[0]?.toLowerCase() === 'head' ? parts.slice(1) : parts;
  return selected.join(' ').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function resolveRemoveSelector(selector, heads) {
  const value = String(selector || '').trim().toLowerCase();
  const ordinal = value.match(/^head\s*(\d+)$/) || value.match(/^(\d+)$/);
  if (ordinal) {
    const index = Number(ordinal[1]) - 1;
    return index >= 0 && index < heads.length ? heads[index] : null;
  }
  return heads.find((head) => (
    head.id.toLowerCase() === value
    || head.name.toLowerCase() === value
    || (head.aliases || []).some((alias) => String(alias).toLowerCase() === value)
  )) || null;
}

async function removeOneHead(existing, ask) {
  if (!existing) {
    return;
  }
  const answer = (await ask(`Remove head "${existing.id}"? [Y/N]: `)).trim().toLowerCase();
  if (answer !== 'y') {
    console.log(systemLine('Cancelled.', 'yellow'));
    return;
  }

  removeHeadFromRegistry(existing.id);
  clearRemovedHeadConfig(existing.id);
  invalidateHealth();
  writeTaskLog({ type: 'head.removed', head: existing.id });
  console.log(systemLine(`Head "${existing.id}" removed.`, 'green'));
}

function clearRemovedHeadConfig(id) {
  updateProjectConfig((config) => {
    for (const section of ['auth', 'models', 'roles', 'prompts']) {
      if (config[section]) delete config[section][id];
    }
    if (config.mode?.head === id) {
      config.mode = { ...config.mode, type: 'auto', head: null };
    }
    if (config.workflow) {
      for (const key of ['chat_head', 'code_head', 'advisor_head']) {
        if (config.workflow[key] === id) {
          config.workflow[key] = null;
        }
      }
    }
    return config;
  });
}

export async function handleHeadEditCommand(tokens) {
  const { positional, flags } = parseHeadFlags(tokens);
  const id = (positional[0] || '').toLowerCase();
  if (!id) {
    console.log(systemLine('Usage: /hydra head edit <id> [--model X] [--role X] [--base-url URL] [--key-env VAR] [--name X] [--tag "[X]"] [--color X] [--aliases a,b]', 'yellow'));
    return;
  }
  const existing = getHead(id);
  if (!existing) {
    console.log(systemLine(`No head "${id}" registered.`, 'yellow'));
    return;
  }

  const patch = {};
  if (flags.model !== undefined) patch.defaultModel = flags.model === '' ? null : flags.model;
  if (flags.role !== undefined) patch.defaultRole = flags.role === '' ? null : flags.role;
  if (flags['base-url'] !== undefined) patch.baseUrl = flags['base-url'] === '' ? null : flags['base-url'];
  if (flags['key-env'] !== undefined) patch.envKey = flags['key-env'];
  if (flags.name !== undefined) patch.name = flags.name;
  if (flags.tag !== undefined) patch.tag = flags.tag;
  if (flags.color !== undefined) {
    patch.color = flags.color;
    const colorClash = listHeads().find((h) => h.id !== id && h.color === flags.color);
    if (colorClash) {
      console.log(systemLine(`Note: color "${flags.color}" is already used by "${colorClash.id}". Continuing.`, 'yellow'));
    }
  }
  if (flags.aliases !== undefined || flags.alias !== undefined || flags.nickname !== undefined) {
    patch.aliases = flags.aliases || flags.alias || flags.nickname || [];
  }

  if (Object.keys(patch).length === 0) {
    console.log(systemLine('Nothing to update. Pass at least one --flag.', 'yellow'));
    return;
  }

  if (existing.builtin) {
    const builtinLocked = ['providerId', 'envKey'];
    for (const key of builtinLocked) {
      if (patch[key] !== undefined) {
        console.log(systemLine(`Cannot change "${key}" on built-in head "${id}".`, 'yellow'));
        delete patch[key];
      }
    }
  }

  const updated = updateHeadInRegistry(id, patch);
  invalidateHealth();
  writeTaskLog({ type: 'head.edited', head: id, fields: Object.keys(patch) });
  console.log(systemLine(`Head "${id}" updated.`, 'green'));
  if (updated.defaultModel) console.log(`  model:    ${updated.defaultModel}`);
  if (updated.defaultRole) console.log(`  role:     ${updated.defaultRole}`);
  if (updated.aliases?.length) console.log(`  aliases:  ${updated.aliases.join(', ')}`);
  if (updated.baseUrl) console.log(`  base_url: ${updated.baseUrl}`);
  if (updated.envKey) console.log(`  env_key:  ${updated.envKey}`);
}

export async function handleHeadTestCommand(tokens) {
  const id = (tokens[0] || '').toLowerCase();
  if (!id) {
    console.log(systemLine('Usage: /hydra head test <id>', 'yellow'));
    return;
  }
  const connected = detectConnectedHeads().find((h) => h.id === id);
  if (!connected) {
    console.log(systemLine(`No head "${id}" registered.`, 'yellow'));
    return;
  }
  if (!connected.callable) {
    console.log(systemLine(`Head "${id}" is not callable yet (auth mode: ${connected.authMode}).`, 'yellow'));
    if (connected.subscriptionReason) {
      console.log(`  reason: ${subscriptionStatusDetail(connected)}`);
    } else if (connected.envKey && !process.env[connected.envKey]) {
      console.log(`  reason: ${connected.envKey} not set`);
    }
    return;
  }

  console.log(`Testing ${connected.tag} ${connected.name} ...`);
  const result = await verifyHead(connected, { timeoutMs: 20000 });
  if (result.verified) {
    console.log(systemLine(`${connected.name} OK.`, 'green'));
  } else {
    console.log(systemLine(`${connected.name} FAILED: ${result.error || 'unknown'}`, 'yellow'));
  }
}
