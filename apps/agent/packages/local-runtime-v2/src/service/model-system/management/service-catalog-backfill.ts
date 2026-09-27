import {
  catalogFactsForModelIds,
  type ProviderPresetCatalogOptions,
} from '../catalog/provider-presets/provider-presets.service.js';
import type { LocalCustomProvidersConfig, ModelSystemConfigPort } from '../contracts.js';

/// A model of a custom gateway, named the two ways the config names it.
interface CustomModelRef {
  readonly providerKey: string;
  readonly modelId: string;
}

/// Writes the effort ladder the catalog states onto models that were connected
/// before anything asked it.
///
/// **Nothing draws the ladder from the catalog, and that is the reason this
/// exists.** Both the picker's rungs and the effort a turn carries are read from
/// the entry — `thinking.effortOptions` — so a gateway whose models were saved
/// with nothing but an id shows no effort at all, however much the catalog knows
/// about the id. `enrichModelsFromCatalog` covers everyone who connects from now
/// on; this covers everyone already connected, which is every install that
/// predates it.
///
/// **Idempotent by shape, and silent when it has nothing to say.** An entry that
/// states a ladder is left alone, so a second boot finds nothing to fill and
/// writes nothing; a gateway the catalog has never heard of keeps a config
/// byte-identical to the one the reader wrote.
///
/// Only the ladder is filled. Modalities are asked for where they are used — the
/// resolver falls back by id — so writing them here would be a second answer to
/// a question that already has one.
export async function backfillCustomProviderModelEffort(
  config: Pick<ModelSystemConfigPort, 'read' | 'updateByok'>,
  options: ProviderPresetCatalogOptions = {},
): Promise<number> {
  const missing = modelsMissingEffort(config.read().custom_provider);
  if (missing.length === 0) return 0;

  const facts = await catalogFactsForModelIds(
    missing.map(({ modelId }) => modelId),
    options,
  );
  if (facts.size === 0) return 0;

  let filled = 0;
  await config.updateByok((draft) => {
    const tree = (draft.custom_provider ?? {}) as LocalCustomProvidersConfig;
    for (const { providerKey, modelId } of missing) {
      const effortOptions = facts.get(modelId)?.effortOptions;
      if (!effortOptions?.length) continue;
      const model = tree[providerKey]?.models?.[modelId];
      // The draft is the config as it stands now, and the reader may have saved
      // the provider between the read above and this write.
      if (!model || model.thinking?.effortOptions !== undefined) continue;
      model.thinking = { ...model.thinking, effortOptions: [...effortOptions] };
      filled += 1;
    }
    draft.custom_provider = tree as Record<string, unknown>;
  });
  return filled;
}

function modelsMissingEffort(
  providers: LocalCustomProvidersConfig | undefined,
): CustomModelRef[] {
  const missing: CustomModelRef[] = [];
  for (const [providerKey, provider] of Object.entries(providers ?? {})) {
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      if (model.thinking?.effortOptions !== undefined) continue;
      missing.push({ providerKey, modelId });
    }
  }
  return missing;
}
