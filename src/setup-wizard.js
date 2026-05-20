import fs from 'node:fs';
import path from 'node:path';
import { systemLine } from './logo.js';
import {
  formatActiveHeadHeader,
  formatHeadDisplayName,
  formatHeadDisplayTag,
  isRepurposedBuiltinHead,
} from './head-display.js';
import { formatModelShortName } from './model-display.js';
import { MENU_BACK, canUseInteractiveMenu, promptMenuChoice, readFilterableMenu } from './menu.js';
import { handleHeadRemoveCommand } from './head-commands.js';
import {
  addHeadToRegistry,
  getHeadCap,
  listHeads,
  updateHeadInRegistry,
} from './heads.js';
import {
  ROLE_COMMANDS,
  getReservedCommandNames,
  isReservedCommandName,
  normalizeCommandName,
} from './command-registry.js';
import { HEAD_ROLES } from './provider-commands.js';
import { HYDRA_STATE_DIR, readProjectConfig, updateProjectConfig, writeTaskLog } from './project.js';
import { invalidateHealth } from './health.js';
import { truncateText } from './text-utils.js';
import { detectConnectedHeads } from './heads.js';

let headCapOverrideAccepted = false;

export async function handleSetupCommand(ask, argsForSetup = [], deps = {}) {
  const { printAuthStatus, ensureSubscriptionAgreement } = deps;
  const setupTarget = String(argsForSetup[0] || '').toLowerCase();
  if (setupTarget === 'head' || setupTarget === 'heads') {
    await handleGuidedHeadSetup(argsForSetup.slice(1), ask);
    return;
  }

  if (setupTarget) {
    console.log(systemLine('Usage: /setup | /setup head <slot> | /setup head new', 'yellow'));
    return;
  }

  console.log('[HYDRA] SETUP');
  console.log('');
  console.log('Choose how Hydra should treat each head.');
  console.log('API key mode uses official provider SDK requests and is metered.');
  console.log('Subscription mode marks the head connected, but automated SDK calls stay disabled until a provider-approved subscription interface exists.');
  console.log('');
  console.log('  [K] Keep current');
  console.log('  [A] API key');
  console.log('  [S] Subscription');
  console.log('  [O] Off');
  console.log('');

  const changes = [];
  for (const head of listHeads()) {
    const status = detectConnectedHeads().find((candidate) => candidate.id === head.id);
    const apiKeyStatus = head.envKey
      ? (process.env[head.envKey] ? 'API key detected' : `${head.envKey} not found`)
      : '(subscription-only, no key required)';
    console.log(formatActiveHeadHeader(status));
    console.log(`Current: ${status.authMode} (${status.connectionLabel})`);
    console.log(`Key:     ${apiKeyStatus}`);

    const answer = (await ask('Mode [K/A/S/O]: ')).trim().toLowerCase();
    const nextMode = setupChoiceToAuthMode(answer);
    if (!nextMode) {
      console.log(systemLine('Invalid choice. Keeping current setting.', 'yellow'));
      console.log('');
      continue;
    }

    if (nextMode === 'keep') {
      console.log(systemLine(`Keeping ${head.name} at ${status.authMode}.`, 'green'));
      console.log('');
      continue;
    }

    if (nextMode === 'subscription') {
      const agreed = ensureSubscriptionAgreement ? await ensureSubscriptionAgreement(ask) : true;
      if (!agreed) {
        console.log('');
        continue;
      }
    }

    updateProjectConfig((config) => {
      config.auth[head.id] = nextMode;
      return config;
    });
    invalidateHealth();
    writeTaskLog({
      type: 'auth.mode_set',
      head: head.id,
      mode: nextMode,
      source: 'setup',
    });
    changes.push(`${head.name}: ${nextMode}`);
    console.log(systemLine(`${head.name} auth mode set to ${nextMode}.`, 'green'));
    console.log('');
  }

  console.log(systemLine('Setup complete.', 'green'));
  if (changes.length) {
    console.log(`Changed: ${changes.join(', ')}`);
  } else {
    console.log('Changed: none');
  }
  console.log('');
  console.log('Private API keys should be placed in .hydra-state/.env or supplied by the shell environment.');
  console.log('Hydra never prints key values.');
  console.log('');
  if (printAuthStatus) {
    printAuthStatus();
  }
  console.log('');
  await runSetupFinaleMenu(ask);
}

export async function runSetupFinaleMenu(ask) {
  while (true) {
    const removable = listHeads();
    const labels = [
      'Add a new head',
      removable.length ? 'Remove an existing head' : 'Remove an existing head (none removable)',
      'Done',
    ];
    const choice = await promptMenuChoice(ask, 'Anything else?', labels, labels.length - 1);
    if (choice === MENU_BACK || choice === null || choice === 2) {
      return;
    }
    if (choice === 0) {
      console.log('');
      await handleGuidedHeadSetup(['new'], ask);
      console.log('');
      continue;
    }
    if (choice === 1) {
      if (!removable.length) {
        console.log(systemLine('No heads to remove. Use /setup head new to add one.', 'yellow'));
        continue;
      }
      const ids = removable.map((head) => `${head.id} — ${head.name} (${head.providerId})`);
      const sel = await promptMenuChoice(ask, 'Remove which head?', [...ids, 'Cancel'], ids.length);
      if (sel === MENU_BACK || sel === null || sel === ids.length) {
        continue;
      }
      console.log('');
      await handleHeadRemoveCommand([removable[sel].id], ask);
      console.log('');
    }
  }
}

export async function handleGuidedHeadSetup(argsForHeadSetup, ask) {
  console.log('[HYDRA] SETUP HEAD');
  console.log('');

  const target = await resolveGuidedHeadTarget(argsForHeadSetup[0], ask);
  if (!target) {
    return;
  }

  const existing = target.existing;
  const currentConfig = readProjectConfig();
  let id = target.id;
  const heads = listHeads();
  if (!existing) {
    const capAccepted = await confirmHeadCapOverrideIfNeeded({ ask, currentCount: heads.length, cap: getHeadCap() });
    if (!capAccepted) {
      console.log(systemLine('Head setup cancelled.', 'yellow'));
      return;
    }
  }

  let providerChoice = target.providerChoice || null;
  let model = null;
  let role = null;
  let customPrompt = null;
  let customize = false;
  let details = null;
  let step = providerChoice ? 'model' : 'provider';

  while (!details) {
    if (step === 'provider') {
      const selected = await promptProviderChoice(ask, existing, providerChoice);
      if (selected === MENU_BACK || selected === null) {
        console.log(systemLine('Head setup cancelled.', 'yellow'));
        return;
      }
      providerChoice = selected;
      if (!existing && !target.id) {
        id = uniqueHeadId(providerChoice.defaultId || 'head', heads);
      }
      step = 'model';
      continue;
    }

    if (step === 'model') {
      const selected = await promptModelChoice(
        ask,
        providerChoice,
        existing?.defaultModel || (id ? currentConfig.models?.[id] : null) || providerChoice.defaultModel || null,
        existing?.envKey || null,
      );
      if (selected === MENU_BACK) {
        step = 'provider';
        continue;
      }
      model = selected;
      step = 'role';
      continue;
    }

    if (step === 'role') {
      const selected = await promptHeadRole(ask, id ? currentConfig.roles?.[id] : null);
      if (selected === MENU_BACK) {
        step = 'model';
        continue;
      }
      role = selected;
      step = 'prompt';
      continue;
    }

    if (step === 'prompt') {
      const selected = await promptHeadPrompt(ask, role, id ? currentConfig.prompts?.[id] : null);
      if (selected === MENU_BACK) {
        step = 'role';
        continue;
      }
      customPrompt = selected;
      step = 'setup-style';
      continue;
    }

    if (step === 'setup-style') {
      const selected = await promptSetupCustomization(ask, existing, id || uniqueHeadId(providerChoice.defaultId || 'head', heads));
      if (selected === MENU_BACK) {
        step = 'prompt';
        continue;
      }
      customize = selected;
      step = 'details';
      continue;
    }

    if (step === 'details') {
      details = await promptGuidedHeadDetails({
        ask,
        existing,
        providerChoice,
        currentId: id,
        model,
        customize,
        heads,
      });
      if (details === MENU_BACK) {
        details = null;
        step = 'setup-style';
        continue;
      }
      if (!details) {
        console.log(systemLine('Head setup cancelled.', 'yellow'));
        return;
      }
    }
  }

  id = details.id;
  const name = details.name;
  const baseUrl = details.baseUrl;
  const envKey = details.envKey;
  const tag = details.tag;

  const patch = {
    id,
    name,
    tag,
    providerId: providerChoice.providerId,
    envKey,
    defaultModel: model,
    defaultRole: role,
    baseUrl,
    aliases: existing?.aliases || [],
    color: existing?.color || null,
    builtin: Boolean(existing?.builtin),
  };

  let saved;
  if (existing) {
    saved = updateHeadInRegistry(id, patch);
  } else {
    saved = addHeadToRegistry(patch);
  }

  updateProjectConfig((config) => {
    config.auth = config.auth || {};
    config.models = config.models || {};
    config.roles = config.roles || {};
    config.prompts = config.prompts || {};
    config.auth[id] = 'api-key';
    config.models[id] = model;
    config.roles[id] = role || null;
    config.prompts[id] = customPrompt || null;
    return config;
  });

  invalidateHealth();
  writeTaskLog({
    type: 'setup.head_saved',
    head: id,
    providerId: providerChoice.providerId,
    model,
    role,
    customPrompt: Boolean(customPrompt),
    created: !existing,
  });

  console.log('');
  console.log(systemLine(`${saved.name} saved.`, 'green'));
  console.log(`  Head:     ${saved.id}`);
  console.log(`  Provider: ${saved.providerId}${saved.baseUrl ? ` (${saved.baseUrl})` : ''}`);
  console.log(`  Model:    ${formatModelShortName(saved.defaultModel)} (${saved.defaultModel})`);
  console.log(`  Role:     ${role || 'none'}`);
  console.log(`  Prompt:   ${customPrompt ? 'custom' : 'default'}`);
  console.log(`  API key:  ${envKey}${process.env[envKey] ? ' set' : ' not set'}`);
  console.log('');
  console.log(`/hydra head test ${saved.id}`);
}

async function resolveGuidedHeadTarget(selector, ask) {
  const heads = listHeads();
  let value = String(selector || '').trim().toLowerCase();
  if (!value) {
    const labels = [
      ...heads.map((head, index) => `Head ${index + 1} - ${formatHeadDisplayName(head)}`),
      'Add a new head',
    ];
    const index = await promptMenuChoice(ask, 'Head', labels, 0);
    if (index === MENU_BACK || index === null) {
      return null;
    }
    value = index < heads.length ? String(index + 1) : 'new';
  }

  if (value === 'new' || value === 'add' || value === '+') {
    return { id: null, existing: null };
  }

  const ordinal = value.match(/^head\s*(\d+)$/) || value.match(/^(\d+)$/);
  if (ordinal) {
    const index = Number(ordinal[1]) - 1;
    if (index >= 0 && index < heads.length) {
      return { id: heads[index].id, existing: heads[index] };
    }
    if (index === heads.length) {
      return { id: `head${index + 1}`, existing: null };
    }
    console.log(systemLine(`No head slot ${index + 1}. Use /heads to list configured heads.`, 'yellow'));
    return null;
  }

  const existing = heads.find((head) => head.id === value || head.name.toLowerCase() === value);
  if (existing) {
    return { id: existing.id, existing };
  }

    console.log(systemLine(`Unknown head target "${value}". Use /setup head <slot> or /setup head new.`, 'yellow'));
  return null;
}

function normalizeHeadId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function uniqueHeadId(rawBase, heads) {
  const base = normalizeHeadId(rawBase) || 'head';
  const reserved = new Set(getReservedCommandNames());
  const used = new Set(heads.map((head) => head.id));
  if (!used.has(base) && !reserved.has(base)) {
    return base;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}${index}`;
    if (!used.has(candidate) && !reserved.has(candidate)) {
      return candidate;
    }
  }
  return `head${heads.length + 1}`;
}

async function promptHeadId(ask, currentId, heads) {
  const fallback = uniqueHeadId(currentId, heads);
  const id = normalizeHeadId(await promptText(ask, `Head id [${fallback}]: `, fallback));
  if (!id || !/^[a-z][a-z0-9_-]*$/.test(id)) {
    console.log(systemLine('Head id must start with a letter and use only lowercase letters, numbers, - or _.', 'yellow'));
    return null;
  }
  if (isReservedCommandName(id)) {
    console.log(systemLine(`Head id "${id}" is reserved for a slash command.`, 'yellow'));
    return null;
  }
  if (heads.some((head) => head.id === id)) {
    console.log(systemLine(`Head "${id}" already exists.`, 'yellow'));
    return null;
  }
  return id;
}

async function promptHeadRole(ask, currentRole) {
  const choices = setupRoleChoices();
  const currentIndex = currentRole ? choices.findIndex((choice) => choice.key === currentRole) : 0;
  const index = await promptMenuChoice(
    ask,
    'Role',
    choices.map((choice) => choice.label),
    currentIndex >= 0 ? currentIndex : 0,
  );
  if (index === MENU_BACK) {
    return MENU_BACK;
  }
  if (index === null) {
    return currentRole || null;
  }
  const choice = choices[index];
  if (choice.key === null) {
    return null;
  }
  if (choice.key !== 'custom') {
    return choice.key;
  }
  const custom = normalizeCommandName(await promptText(ask, 'Custom role name: ', currentRole || 'assistant'));
  return custom || currentRole || null;
}

export function setupRoleChoices() {
  const roleNames = [
    ...Object.keys(ROLE_COMMANDS).filter((name) => !['ask', 'fast', 'all'].includes(name)),
    ...Object.keys(HEAD_ROLES),
  ];
  const unique = Array.from(new Set(roleNames))
    .sort((a, b) => a.localeCompare(b));
  return [
    { key: null, label: 'None / default routing' },
    ...unique.map((name) => {
      const definition = ROLE_COMMANDS[name];
      const headRole = HEAD_ROLES[name];
      const description = definition?.description || headRole?.instruction || 'Custom Hydra role.';
      return { key: name, label: `/${name} - ${truncateText(description, 70)}` };
    }),
    { key: 'custom', label: 'Custom role name' },
  ];
}

async function promptHeadPrompt(ask, role, currentPrompt) {
  const roleInstruction = role ? HEAD_ROLES[role]?.instruction : null;
  const choices = [
    {
      key: 'default',
      label: roleInstruction ? `Default prompt for /${role}` : 'Default Hydra prompt',
    },
    { key: 'custom', label: 'Custom system prompt' },
  ];
  if (currentPrompt) {
    choices.push({ key: 'keep', label: 'Keep existing custom prompt' });
    choices.push({ key: 'clear', label: 'Clear existing custom prompt' });
  }
  const index = await promptMenuChoice(ask, 'Prompt', choices.map((choice) => choice.label), currentPrompt ? 2 : 0);
  if (index === MENU_BACK) {
    return MENU_BACK;
  }
  if (index === null) {
    return currentPrompt || null;
  }
  const choice = choices[index];
  if (choice.key === 'keep') {
    return currentPrompt || null;
  }
  if (choice.key === 'clear' || choice.key === 'default') {
    return null;
  }
  const fallback = currentPrompt || roleInstruction || '';
  const custom = await promptText(ask, 'Custom system prompt: ', fallback);
  return custom.trim() || null;
}

async function promptSetupCustomization(ask, existing, defaultId) {
  const labels = existing
    ? ['Use defaults for name/env/base URL', 'Customize name/env/base URL']
    : [`Use default head details (${defaultId})`, 'Customize head id/name/env/base URL'];
  const index = await promptMenuChoice(ask, 'Setup style', labels, 0);
  if (index === MENU_BACK) {
    return MENU_BACK;
  }
  return index === 1;
}

async function promptGuidedHeadDetails({ ask, existing, providerChoice, currentId, model, customize, heads }) {
  let id = currentId || uniqueHeadId(providerChoice.defaultId || 'head', heads);
  if (!existing && customize) {
    id = await promptHeadId(ask, id, heads);
    if (!id) {
      return null;
    }
  }

  const displayHead = {
    ...(existing || {}),
    id,
    name: existing?.name || providerChoice.defaultName || titleFromId(id),
    tag: existing?.tag || `[${id.toUpperCase()}]`,
    providerId: providerChoice.providerId,
    baseUrl: providerChoice.baseUrl || existing?.baseUrl || null,
    defaultModel: model || providerChoice.defaultModel || existing?.defaultModel || null,
    model: model || providerChoice.defaultModel || existing?.defaultModel || null,
    builtin: Boolean(existing?.builtin),
  };
  const defaultName = isRepurposedBuiltinHead(displayHead)
    ? formatHeadDisplayName(displayHead)
    : (existing?.name || providerChoice.defaultName || titleFromId(id));
  const name = customize
    ? await promptText(ask, `Head name [${defaultName}]: `, defaultName)
    : defaultName;
  const baseUrl = await promptBaseUrlForProvider(ask, providerChoice, existing, customize);
  const envKey = await promptEnvKey(ask, providerChoice, id, baseUrl, existing?.envKey, customize);
  if (envKey === MENU_BACK) {
    return MENU_BACK;
  }
  const stored = await promptAndStoreApiKey(ask, envKey);
  if (stored === MENU_BACK) {
    return MENU_BACK;
  }

  return {
    id,
    name,
    tag: isRepurposedBuiltinHead(displayHead) ? formatHeadDisplayTag(displayHead) : (existing?.tag || `[${id.toUpperCase()}]`),
    baseUrl,
    envKey,
  };
}

async function promptProviderChoice(ask, existing, currentChoice = null) {
  const choices = setupProviderChoices();
  const currentIndex = currentChoice
    ? choices.findIndex((choice) => choice.kind === currentChoice.kind)
    : providerChoiceIndexForHead(choices, existing);
  const index = await promptMenuChoice(ask, 'Provider', choices.map((choice) => choice.label), currentIndex >= 0 ? currentIndex : 0);
  if (index === MENU_BACK) {
    return MENU_BACK;
  }
  return index === null ? null : choices[index];
}

function providerChoiceIndexForHead(choices, existing) {
  if (!existing) {
    return 0;
  }
  const baseUrl = String(existing.baseUrl || '').toLowerCase();
  if (baseUrl) {
    const baseMatch = choices.findIndex((choice) => choice.baseUrl && baseUrl.includes(String(choice.baseUrl).toLowerCase()));
    if (baseMatch >= 0) {
      return baseMatch;
    }
    if (baseUrl.includes('openrouter')) return choices.findIndex((choice) => choice.kind === 'openrouter');
    if (baseUrl.includes('groq')) return choices.findIndex((choice) => choice.kind === 'groq');
    if (baseUrl.includes('together')) return choices.findIndex((choice) => choice.kind === 'together');
    if (baseUrl.includes('deepseek')) return choices.findIndex((choice) => choice.kind === 'deepseek');
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) return choices.findIndex((choice) => choice.kind === 'ollama');
    return choices.findIndex((choice) => choice.kind === 'custom-openai-compatible');
  }
  return choices.findIndex((choice) => choice.providerId === existing.providerId && !choice.baseUrl);
}

function setupProviderChoices() {
  return [
    {
      kind: 'anthropic',
      providerId: 'anthropic',
      label: 'Anthropic Claude API',
      defaultId: 'claude',
      defaultName: 'Claude',
      defaultEnvKey: 'ANTHROPIC_API_KEY',
      defaultModel: 'claude-opus-4-7',
      models: ['claude-opus-4-7', 'claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'custom'],
    },
    {
      kind: 'openai',
      providerId: 'openai',
      label: 'OpenAI API',
      defaultId: 'openai',
      defaultName: 'OpenAI',
      defaultEnvKey: 'OPENAI_API_KEY',
      defaultModel: 'gpt-5.5',
      models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-4o', 'o3', 'custom'],
    },
    {
      kind: 'google-gemini',
      providerId: 'google-gemini',
      label: 'Google Gemini API',
      defaultId: 'gemini',
      defaultName: 'Gemini',
      defaultEnvKey: 'GOOGLE_API_KEY',
      defaultModel: 'gemini-3-pro-preview',
      models: ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'custom'],
    },
    {
      kind: 'openrouter',
      providerId: 'openai',
      label: 'OpenRouter',
      defaultId: 'openrouter',
      defaultName: 'OpenRouter',
      defaultEnvKey: 'OPENROUTER_API_KEY',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'openrouter/auto',
      models: ['openrouter/auto', 'openai/gpt-5.4', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat', 'custom'],
    },
    {
      kind: 'groq',
      providerId: 'openai',
      label: 'Groq',
      defaultId: 'groq',
      defaultName: 'Groq',
      defaultEnvKey: 'GROQ_API_KEY',
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'deepseek-r1-distill-llama-70b', 'custom'],
    },
    {
      kind: 'together',
      providerId: 'openai',
      label: 'Together AI',
      defaultId: 'together',
      defaultName: 'Together',
      defaultEnvKey: 'TOGETHER_API_KEY',
      baseUrl: 'https://api.together.xyz/v1',
      defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-Coder-32B-Instruct', 'custom'],
    },
    {
      kind: 'deepseek',
      providerId: 'openai',
      label: 'DeepSeek',
      defaultId: 'deepseek',
      defaultName: 'DeepSeek',
      defaultEnvKey: 'DEEPSEEK_API_KEY',
      baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner', 'custom'],
    },
    {
      kind: 'ollama',
      providerId: 'openai',
      label: 'Ollama local',
      defaultId: 'ollama',
      defaultName: 'Ollama',
      defaultEnvKey: 'OLLAMA_API_KEY',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: 'llama3.3',
      models: ['llama3.3', 'qwen2.5-coder', 'codellama', 'custom'],
    },
    {
      kind: 'custom-openai-compatible',
      providerId: 'openai',
      label: 'Custom OpenAI-compatible endpoint',
      defaultId: 'custom-head',
      defaultName: 'Custom Head',
      defaultEnvKey: 'CUSTOM_API_KEY',
      baseUrl: 'https://example.com/v1',
      defaultModel: 'custom-model',
      models: ['custom'],
    },
  ];
}

async function promptBaseUrlForProvider(ask, providerChoice, existing, customize) {
  if (!providerChoice.baseUrl) {
    return null;
  }
  const fallback = existing?.baseUrl || providerChoice.baseUrl;
  if (!customize && providerChoice.kind !== 'custom-openai-compatible') {
    return fallback;
  }
  return promptText(ask, `Base URL [${fallback}]: `, fallback);
}

async function promptModelChoice(ask, providerChoice, currentModel, currentEnvKey = null) {
  const choices = await setupModelChoices(providerChoice, currentModel, currentEnvKey);
  if (canUseInteractiveMenu() && shouldUseGroupedModelPicker(providerChoice, choices)) {
    const selected = await promptFilterableModelChoice(providerChoice, choices, currentModel);
    if (selected === MENU_BACK) {
      return MENU_BACK;
    }
    if (selected === null) {
      return currentModel || firstModelId(choices);
    }
    if (selected !== 'custom') {
      return selected;
    }
    return promptText(ask, 'Model id: ', currentModel || firstModelId(choices));
  }

  const labels = choices.map((choice) => modelChoiceLabel(choice, currentModel, true));
  const currentIndex = currentModel ? choices.findIndex((choice) => choice.id === currentModel) : -1;
  const index = await promptMenuChoice(ask, 'Model', labels, currentIndex >= 0 ? currentIndex : 0);
  if (index === MENU_BACK) {
    return MENU_BACK;
  }
  if (index === null) {
    return currentModel || firstModelId(choices);
  }
  if (choices[index].id !== 'custom') {
    return choices[index].id;
  }
  return promptText(ask, 'Model id: ', currentModel || firstModelId(choices));
}

function shouldUseGroupedModelPicker(providerChoice, choices) {
  if (choices.length > 30) {
    return true;
  }
  if (['openrouter', 'groq'].includes(providerChoice.kind)) {
    return true;
  }
  return choices.some((choice) => choice.billing === 'free');
}

async function promptFilterableModelChoice(providerChoice, choices, currentModel) {
  const catalog = modelChoiceCatalog(providerChoice, choices, currentModel);
  const selected = await readFilterableMenu({ title: 'Model', catalog });
  if (selected === MENU_BACK) {
    return MENU_BACK;
  }
  return selected?.modelId || null;
}

function modelChoiceCatalog(providerChoice, choices, currentModel) {
  const groups = [
    { billing: 'free', label: `${providerChoice.label} free models` },
    { billing: 'paid', label: `${providerChoice.label} paid models` },
    { billing: 'custom', label: 'Custom' },
  ];
  return groups
    .map((group) => ({
      label: group.label,
      items: choices
        .filter((choice) => choice.billing === group.billing)
        .map((choice) => ({
          name: choice.id,
          slashForm: choice.id === 'custom' ? 'Custom model id' : choice.id,
          description: modelDescription(choice, currentModel),
          modelId: choice.id,
        })),
    }))
    .filter((section) => section.items.length);
}

function modelChoiceLabel(choice, currentModel, includeBilling = false) {
  if (choice.id === 'custom') {
    return 'Custom model id';
  }
  const billing = includeBilling ? `[${choice.billing === 'free' ? 'Free' : 'Paid'}] ` : '';
  const current = currentModel && choice.id === currentModel ? ' (current)' : '';
  return `${billing}${choice.id} - ${formatModelShortName(choice.id)}${current}`;
}

function modelDescription(choice, currentModel) {
  if (choice.id === 'custom') {
    return 'type a model id manually';
  }
  const current = currentModel && choice.id === currentModel ? ' - current model' : '';
  return `${formatModelShortName(choice.id)}${current}`;
}

async function setupModelChoices(providerChoice, currentModel = null, currentEnvKey = null) {
  const fallback = uniqueModelChoices([
    currentModel,
    providerChoice.defaultModel,
    ...(providerChoice.models || []),
    'custom',
  ]);
  const remote = await fetchProviderModelChoices(providerChoice, currentEnvKey);
  if (remote.models.length) {
    console.log(systemLine(`Loaded ${remote.models.length} ${providerChoice.label} models.`, 'green'));
  } else if (remote.warning) {
    console.log(systemLine(remote.warning, 'yellow'));
  }

  return sortModelChoices(uniqueModelChoices([
    currentModel,
    providerChoice.defaultModel,
    ...remote.models,
    ...fallback,
    'custom',
  ]));
}

async function fetchProviderModelChoices(providerChoice, currentEnvKey = null) {
  if (providerChoice.kind === 'openrouter') {
    const envKey = currentEnvKey || providerChoice.defaultEnvKey || 'OPENROUTER_API_KEY';
    return fetchJsonModelChoices({
      label: providerChoice.label,
      url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
      envKey,
      requiresKey: false,
    });
  }

  if (providerChoice.kind === 'groq') {
    const envKey = currentEnvKey || providerChoice.defaultEnvKey || 'GROQ_API_KEY';
    return fetchJsonModelChoices({
      label: providerChoice.label,
      url: 'https://api.groq.com/openai/v1/models',
      envKey,
      requiresKey: true,
    });
  }

  return { models: [], warning: null };
}

async function fetchJsonModelChoices({ label, url, envKey, requiresKey }) {
  const apiKey = envKey ? process.env[envKey] : null;
  if (requiresKey && !apiKey) {
    return {
      models: [],
      warning: `${label} live model list requires ${envKey}. Using bundled fallback models until a key is saved.`,
    };
  }

  const headers = { Accept: 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      return {
        models: [],
        warning: `${label} model list returned HTTP ${response.status}. Using bundled fallback models.`,
      };
    }

    const json = await response.json();
    const models = extractModelIds(json);
    return { models, warning: models.length ? null : `${label} returned no models. Using bundled fallback models.` };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timed out' : (error?.message || 'failed');
    return { models: [], warning: `${label} model list ${reason}. Using bundled fallback models.` };
  } finally {
    clearTimeout(timeout);
  }
}

function extractModelIds(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  return uniqueModelValues(rows
    .filter((row) => typeof row === 'string' || row?.active !== false)
    .filter((row) => typeof row === 'string' || outputsText(row))
    .map((row) => modelChoiceFromValue(row))
    .filter(Boolean));
}

function outputsText(model) {
  const out = model?.architecture?.output_modalities;
  if (!Array.isArray(out)) return true;
  return out.includes('text');
}

function uniqueModelChoices(values) {
  const result = uniqueModelValues(values);
  const hasCustom = result.some((choice) => choice.id.toLowerCase() === 'custom');
  if (!hasCustom) {
    result.push(modelChoiceFromValue('custom'));
  }
  return result;
}

function uniqueModelValues(values) {
  const result = [];
  const byId = new Map();
  for (const value of values) {
    const choice = modelChoiceFromValue(value);
    if (!choice) {
      continue;
    }
    const key = choice.id.toLowerCase();
    const existing = byId.get(key);
    if (existing) {
      if (existing.billing !== 'free' && choice.billing === 'free') {
        existing.billing = 'free';
      }
      if (!existing.name && choice.name) {
        existing.name = choice.name;
      }
      continue;
    }
    byId.set(key, choice);
    result.push(choice);
  }
  return result;
}

function modelChoiceFromValue(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const id = value.trim();
    if (!id) {
      return null;
    }
    return { id, billing: inferModelBilling({ id }), name: null };
  }
  const id = String(value.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    billing: inferModelBilling(value),
    name: value.name || null,
  };
}

function inferModelBilling(model) {
  const id = String(model?.id || '').toLowerCase();
  if (id === 'custom') {
    return 'custom';
  }
  if (id.endsWith(':free') || isZeroPricing(model?.pricing)) {
    return 'free';
  }
  return 'paid';
}

function isZeroPricing(pricing) {
  if (!pricing || typeof pricing !== 'object') {
    return false;
  }
  const prompt = pricing.prompt;
  const completion = pricing.completion;
  if (prompt === null || prompt === undefined || prompt === '') return false;
  if (completion === null || completion === undefined || completion === '') return false;
  return Number(prompt) === 0 && Number(completion) === 0;
}

function sortModelChoices(choices) {
  const rank = { free: 0, paid: 1, custom: 2 };
  return [...choices].sort((left, right) => {
    const leftRank = rank[left.billing] ?? 1;
    const rightRank = rank[right.billing] ?? 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' });
  });
}

function firstModelId(choices) {
  return choices.find((choice) => choice.id !== 'custom')?.id || 'custom-model';
}

async function promptEnvKey(ask, providerChoice, headId, baseUrl, currentEnvKey, customize) {
  const fallback = currentEnvKey || envKeyForProvider(providerChoice, headId, baseUrl);
  const choices = setupEnvKeyChoices(providerChoice, headId, baseUrl, fallback);
  const index = await promptMenuChoice(ask, 'API key env var', choices.map((choice) => choice.label), 0);
  if (index === MENU_BACK) {
    return MENU_BACK;
  }
  if (index === null) {
    return fallback.toUpperCase();
  }
  const choice = choices[index];
  if (choice.key !== 'custom') {
    return choice.key.toUpperCase();
  }
  return promptText(ask, `API key env var [${fallback}]: `, fallback).then((value) => value.toUpperCase());
}

function setupEnvKeyChoices(providerChoice, headId, baseUrl, fallback) {
  const headSpecific = `${headId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  const values = [
    fallback,
    providerChoice.defaultEnvKey,
    envKeyForProvider(providerChoice, headId, baseUrl),
    headSpecific,
  ].filter(Boolean).map((value) => value.toUpperCase());
  const unique = Array.from(new Set(values));
  return [
    ...unique.map((key) => ({ key, label: `Use ${key}` })),
    { key: 'custom', label: 'Custom env var name' },
  ];
}

function envKeyForProvider(providerChoice, headId, baseUrl) {
  const lowerBase = String(baseUrl || '').toLowerCase();
  if (providerChoice.providerId === 'openai' && providerChoice.baseUrl) {
    if (lowerBase.includes('groq')) return 'GROQ_API_KEY';
    if (lowerBase.includes('together')) return 'TOGETHER_API_KEY';
    if (lowerBase.includes('deepseek')) return 'DEEPSEEK_API_KEY';
    if (lowerBase.includes('localhost') || lowerBase.includes('127.0.0.1')) return `${headId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  }
  return providerChoice.defaultEnvKey || `${headId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

async function promptAndStoreApiKey(ask, envKey) {
  if (!canUseInteractiveMenu()) {
    return promptAndStoreApiKeyFallback(ask, envKey);
  }

  const choices = process.env[envKey]
    ? [
        { key: 'keep', label: `Reuse existing ${envKey}` },
        { key: 'replace', label: `Set a new ${envKey}` },
        { key: 'skip', label: 'Skip for now' },
      ]
    : [
        { key: 'skip', label: 'Skip for now' },
        { key: 'paste', label: `Paste API key for ${envKey}` },
      ];

  const index = await promptMenuChoice(ask, 'API key action', choices.map((choice) => choice.label), 0);
  if (index === MENU_BACK) {
    return MENU_BACK;
  }
  if (index === null) {
    return false;
  }

  const action = choices[index].key;
  if (action === 'keep' || action === 'skip') {
    return false;
  }

  const apiKey = (await ask('API key: ')).trim();
  if (!apiKey) {
    console.log(systemLine('No API key entered. You can add it later in .hydra-state/.env.', 'yellow'));
    return false;
  }

  writeEnvValue(envKey, apiKey);
  process.env[envKey] = apiKey;
  console.log(systemLine(`${envKey} saved to .hydra-state/.env.`, 'green'));
  return true;
}

async function promptAndStoreApiKeyFallback(ask, envKey) {
  if (process.env[envKey]) {
    const reuse = (await ask(`${envKey} is already set. Reuse it? [Y/n]: `)).trim().toLowerCase();
    if (!reuse || reuse === 'y' || reuse === 'yes') {
      return false;
    }
  }

  const shouldStore = (await ask(`Paste API key for ${envKey} now? [y/N]: `)).trim().toLowerCase();
  if (shouldStore !== 'y' && shouldStore !== 'yes') {
    return false;
  }

  const apiKey = (await ask('API key: ')).trim();
  if (!apiKey) {
    console.log(systemLine('No API key entered. You can add it later in .hydra-state/.env.', 'yellow'));
    return false;
  }

  writeEnvValue(envKey, apiKey);
  process.env[envKey] = apiKey;
  console.log(systemLine(`${envKey} saved to .hydra-state/.env.`, 'green'));
  return true;
}

function writeEnvValue(key, value) {
  const envFile = path.join(process.cwd(), HYDRA_STATE_DIR, '.env');
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  const line = `${key}=${quoteEnvValue(value)}`;
  const lines = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
    : [];
  let replaced = false;
  const next = lines.map((existingLine) => {
    const match = existingLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match?.[1] === key) {
      replaced = true;
      return line;
    }
    return existingLine;
  }).filter((existingLine, index, arr) => existingLine || index < arr.length - 1);
  if (!replaced) {
    next.push(line);
  }
  fs.writeFileSync(envFile, `${next.join('\n')}\n`, 'utf8');
}

function quoteEnvValue(value) {
  const text = String(value || '');
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

export async function confirmHeadCapOverrideIfNeeded({ ask, currentCount, cap }) {
  if (!Number.isFinite(cap) || currentCount < cap || headCapOverrideAccepted) {
    return true;
  }

  const proceed = (await ask(`Adding this head exceeds the soft cap of ${cap}. Continue adding heads above the cap for this session? [y/N]: `)).trim().toLowerCase();
  if (proceed === 'y' || proceed === 'yes') {
    headCapOverrideAccepted = true;
    return true;
  }
  return false;
}

export function resetHeadCapOverrideForTests() {
  headCapOverrideAccepted = false;
}

async function promptText(ask, question, fallback = '') {
  const answer = (await ask(question)).trim();
  return answer || fallback;
}

function titleFromId(id) {
  return String(id || 'Head')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Head';
}

function setupChoiceToAuthMode(choice) {
  if (!choice || choice === 'k' || choice === 'keep') {
    return 'keep';
  }
  if (choice === 'a' || choice === 'api' || choice === 'api-key') {
    return 'api-key';
  }
  if (choice === 's' || choice === 'sub' || choice === 'subscription') {
    return 'subscription';
  }
  if (choice === 'o' || choice === 'off' || choice === 'none') {
    return 'off';
  }

  return null;
}
