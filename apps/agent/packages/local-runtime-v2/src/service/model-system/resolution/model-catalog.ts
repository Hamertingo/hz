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

/// **A model a gateway serves under a name the catalog has never heard of, and
/// whose window the wire does not settle.**
///
/// Command Code and friends expose `deepseek-v4.1-flash` under a provider id of
/// their own, so `getModels` below has no entry, and the fallback is a guess —
/// 200,000, where the model runs at a million. The gateway's own listing is no
/// better: it states what it feels like, which is what the reader sees while the
/// turn is compacting at a tenth of the window.
///
/// A number here is a **statement** rather than a measurement, and that is why
/// it is a table rather than a formula: the public aggregators carry ten
/// different answers for this one id, one per reseller, so reading from one of
/// them would be dressing a guess as a fact. Add a row when you know the number
/// for the models you run; leave it out and the honest guess above stands.
const MODEL_LIMITS_PATCH: Record<string, { contextWindow: number; maxTokens: number }> = {
  "deepseek-v4.1": { contextWindow: 1_000_000, maxTokens: 384_000 },
  "deepseek-v4.1-flash": { contextWindow: 1_000_000, maxTokens: 384_000 },
};

/// A model id as a gateway spells it, with the reseller's path taken off: a
/// catalog that names `publisher/model` is naming the same model as one that
/// names it bare, so the patch is keyed on the last segment, lowercased.
function patchKey(modelId: string): string {
  return modelId.slice(modelId.lastIndexOf('/') + 1).toLowerCase();
}

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
  // The patch is consulted first, and it wins over the catalog too: a row here
  // is a deliberate statement about a model, and the catalog's own entry for a
  // gateway's id is exactly what is being corrected.
  const patch = MODEL_LIMITS_PATCH[patchKey(modelId)];
  if (patch) return { ...patch, fromCatalog: true };

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
