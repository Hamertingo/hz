import { getModels, getProviders, type Api, type Model } from '@earendil-works/pi-ai';

import { parseProviderId } from './model-key.js';

/**
 * The window a model runs at, and the catalog that answers for it.
 *
 * Split out of the resolver because three call sites need the same answer and none
 * of them may call the others: the resolver's own managed path, the BYOK plan (a
 * custom provider's entry states a window only when its gateway did), and the
 * models screen. A second reading of the same rule is how the screen came to
 * promise a million tokens while the turn compacted at two hundred thousand.
 */

const FALLBACK_MODEL_LIMITS = {
  contextWindow: 200_000,
  maxTokens: 128_000,
} as const;

function positive(value: unknown): number {
  return typeof value === 'number' && value > 0 ? value : 0;
}

export function lookupLocalCatalogModel(provider: string, modelId: string): Model<Api> | undefined {
  const key = parseProviderId(provider)?.providerKey;
  const candidates = key && key !== provider ? [key, provider] : [provider];
  for (const candidate of candidates) {
    const knownProvider = getProviders().find((name) => name === candidate);
    if (!knownProvider) continue;
    const model = getModels(knownProvider).find((entry) => entry.id === modelId);
    if (model) return model;
  }
  return undefined;
}

export function lookupLocalModelLimits(
  provider: string,
  modelId: string,
): {
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly fromCatalog: boolean;
  readonly api?: Api;
  readonly baseUrl?: string;
} {
  const entry = lookupLocalCatalogModel(provider, modelId);
  if (!entry) return { ...FALLBACK_MODEL_LIMITS, fromCatalog: false };
  return {
    contextWindow: positive(entry.contextWindow) || FALLBACK_MODEL_LIMITS.contextWindow,
    maxTokens: positive(entry.maxTokens) || FALLBACK_MODEL_LIMITS.maxTokens,
    fromCatalog: true,
    ...(entry.api ? { api: entry.api } : {}),
    ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
  };
}
