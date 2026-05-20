import { getProvider, resolveProviderForHead } from '../providers.js';

export function createHeadAdapter(head, env = process.env) {
  const providerId = resolveProviderForHead(head);
  if (!providerId) {
    throw new Error(`No provider registered for head "${head.id}" with auth mode "${head.authMode}".`);
  }
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Provider "${providerId}" is not registered.`);
  }
  return provider.create(head, env);
}

export function createHeadAdapters(heads, env = process.env) {
  return new Map(heads.map((head) => [head.id, createHeadAdapter(head, env)]));
}
