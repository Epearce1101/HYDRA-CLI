export class AdapterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdapterError';
  }
}

export function assertConfigured(adapter) {
  if (!adapter.apiKey || !adapter.client) {
    throw new AdapterError(`${adapter.name} is not configured.`);
  }
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

export function estimateCostUsd(tokens, usdPerMillionTokens) {
  return (tokens / 1_000_000) * usdPerMillionTokens;
}

export function getEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildAdapterResponse({
  head,
  model,
  text,
  raw,
  usage = {},
  estimatedTokens,
  estimatedCostUsd,
}) {
  return {
    head,
    model,
    text: text || '',
    raw,
    usage,
    estimatedTokens,
    estimatedCostUsd,
  };
}

export function sanitizeErrorMessage(error) {
  return String(error?.message || error || 'unknown error')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/AIza[0-9A-Za-z_-]+/g, 'AIza***');
}
