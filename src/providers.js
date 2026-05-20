import { AnthropicAdapter } from './adapters/anthropic.js';
import { ClaudeSubscriptionAdapter } from './adapters/claude-subscription.js';
import { CodexSubscriptionAdapter } from './adapters/codex-subscription.js';
import { GoogleGeminiAdapter } from './adapters/google-gemini.js';
import { OpenAIAdapter } from './adapters/openai.js';

export const PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    id: 'anthropic',
    label: 'Anthropic',
    auth: 'api-key',
    defaultEnvKey: 'ANTHROPIC_API_KEY',
    supportsBaseUrl: false,
    create: (headConfig, env) => new AnthropicAdapter(headConfig, env),
  }),
  openai: Object.freeze({
    id: 'openai',
    label: 'OpenAI (and OpenAI-compatible)',
    auth: 'api-key',
    defaultEnvKey: 'OPENAI_API_KEY',
    supportsBaseUrl: true,
    create: (headConfig, env) => new OpenAIAdapter(headConfig, env),
  }),
  'google-gemini': Object.freeze({
    id: 'google-gemini',
    label: 'Google Gemini',
    auth: 'api-key',
    defaultEnvKey: 'GOOGLE_API_KEY',
    supportsBaseUrl: false,
    create: (headConfig, env) => new GoogleGeminiAdapter(headConfig, env),
  }),
  'subscription-claude': Object.freeze({
    id: 'subscription-claude',
    label: 'Claude (subscription CLI)',
    auth: 'subscription',
    defaultEnvKey: null,
    supportsBaseUrl: false,
    create: (headConfig, env) => new ClaudeSubscriptionAdapter(headConfig, env),
  }),
  'subscription-codex': Object.freeze({
    id: 'subscription-codex',
    label: 'Codex (subscription CLI)',
    auth: 'subscription',
    defaultEnvKey: null,
    supportsBaseUrl: false,
    create: (headConfig, env) => new CodexSubscriptionAdapter(headConfig, env),
  }),
});

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

export function listProviders() {
  return Object.values(PROVIDERS);
}

const BUILT_IN_PROVIDER_BY_HEAD = Object.freeze({
  claude: { 'api-key': 'anthropic', subscription: 'subscription-claude' },
  codex: { 'api-key': 'openai', subscription: 'subscription-codex' },
  gemini: { 'api-key': 'google-gemini' },
});

export function resolveProviderForHead(head) {
  // Subscription mode always routes to the subscription-* provider for built-in heads,
  // overriding any saved providerId (which is for api-key mode).
  if (head.authMode === 'subscription') {
    const builtins = BUILT_IN_PROVIDER_BY_HEAD[head.id];
    if (builtins?.subscription) return builtins.subscription;
    return null;
  }
  if (head.providerId && PROVIDERS[head.providerId]) {
    return head.providerId;
  }
  const builtins = BUILT_IN_PROVIDER_BY_HEAD[head.id];
  if (!builtins) return null;
  return builtins['api-key'] || null;
}
