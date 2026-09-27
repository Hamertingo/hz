import type * as acp from '@agentclientprotocol/sdk';

import {
  formatTuiPermissionMode,
  MINIMAX_CODE_PERMISSION_MODES,
  type TuiPermissionMode,
} from '../application/permission-mode.js';
import type { TuiModel, TuiSession, TuiSessionUsage } from '../runtime/port.js';
import { modelSupportsVariant } from './model-selection.js';
import type { TuiAcpRuntime } from './runtime.js';

export const ACP_MODE_DEFAULT = 'default';
export const ACP_MODE_PLAN = 'plan';
export const ACP_CONFIG_PERMISSION_MODE = 'permissionMode';
export const ACP_CONFIG_MODEL = 'model';
export const ACP_CONFIG_THINKING_EFFORT = 'thinkingEffort';

export interface TuiAcpSessionControlState {
  readonly modes: acp.SessionModeState;
  readonly configOptions: acp.SessionConfigOption[];
}

export async function getTuiAcpSessionControlState(
  runtime: TuiAcpRuntime,
  session: TuiSession,
): Promise<TuiAcpSessionControlState> {
  const [planCapabilities, permissionMode, models] = await Promise.all([
    runtime.getPlanModeCapabilities().catch(() => ({ entryEnabled: false })),
    runtime.getPermissionMode().catch(() => undefined),
    runtime.listModels(session.sessionId).catch(() => [] as TuiModel[]),
  ]);
  return {
    modes: modeState(session, planCapabilities.entryEnabled),
    configOptions: configOptions(session, permissionMode, models),
  };
}

export function modeState(session: TuiSession, planEntryEnabled = true): acp.SessionModeState {
  return {
    currentModeId: session.interactionMode === 'plan' ? ACP_MODE_PLAN : ACP_MODE_DEFAULT,
    availableModes: [
      {
        id: ACP_MODE_DEFAULT,
        name: 'Default',
        description: 'Work normally with the configured tools and permission policy.',
      },
      ...(planEntryEnabled || session.interactionMode === 'plan'
        ? [
            {
              id: ACP_MODE_PLAN,
              name: 'Plan',
              description: 'Research and prepare an implementation plan before making changes.',
            },
          ]
        : []),
    ],
  };
}

export function configOptions(
  session: TuiSession,
  permissionMode: TuiPermissionMode | undefined,
  models: readonly TuiModel[],
): acp.SessionConfigOption[] {
  const options: acp.SessionConfigOption[] = [];
  const permissionOption = permissionModeOption(permissionMode);
  if (permissionOption) options.push(permissionOption);
  const modelOption = sessionModelOption(session, models);
  if (modelOption) options.push(modelOption);
  const effortOption = thinkingEffortOption(session, models);
  if (effortOption) options.push(effortOption);
  return options;
}

export function parseModelConfigValue(value: string): {
  providerId: string;
  modelId: string;
  variant?: string;
} {
  const [prefix, provider, model, variantKind, variant, ...extra] = value.split(':');
  if (
    prefix !== 'm' ||
    !provider ||
    !model ||
    (variantKind !== 'u' && variantKind !== 'v') ||
    (variantKind === 'u' && variant !== undefined) ||
    (variantKind === 'v' && variant === undefined) ||
    extra.length > 0
  ) {
    throw new Error(`Invalid model config value: ${value}`);
  }
  return {
    providerId: decodeURIComponent(provider),
    modelId: decodeURIComponent(model),
    ...(variantKind === 'v' ? { variant: decodeURIComponent(variant ?? '') } : {}),
  };
}

export function modelConfigValue(selection: {
  readonly providerId: string;
  readonly modelId: string;
  readonly variant?: string;
}): string {
  const prefix = [
    'm',
    encodeURIComponent(selection.providerId),
    encodeURIComponent(selection.modelId),
  ];
  return selection.variant === undefined
    ? [...prefix, 'u'].join(':')
    : [...prefix, 'v', encodeURIComponent(selection.variant)].join(':');
}

export function usageUpdate(
  snapshot: Awaited<ReturnType<TuiAcpRuntime['getContextSnapshot']>>,
  usage: TuiSessionUsage,
): acp.UsageUpdate | undefined {
  const context = snapshot.contextUsage;
  if (!context || context.contextWindowTokens <= 0) return undefined;
  const costUsd = usage.summary?.costUsd;
  return {
    used: context.usedTokens,
    size: context.contextWindowTokens,
    ...(costUsd === undefined
      ? {}
      : {
          cost: {
            amount: costUsd,
            currency: 'USD',
          },
        }),
  };
}

function permissionModeOption(
  permissionMode: TuiPermissionMode | undefined,
): acp.SessionConfigOption | undefined {
  const current = MINIMAX_CODE_PERMISSION_MODES.find((mode) => mode === permissionMode);
  if (!current) return undefined;
  return {
    type: 'select',
    id: ACP_CONFIG_PERMISSION_MODE,
    name: 'Permission mode',
    description: 'Controls how Hz Agent handles tool permission requests in this process.',
    category: '_permission',
    currentValue: current,
    options: MINIMAX_CODE_PERMISSION_MODES.map((mode) => ({
      value: mode,
      name: formatTuiPermissionMode(mode),
    })),
    _meta: { 'minimax-code/scope': 'process' },
  };
}

function sessionModelOption(
  session: TuiSession,
  models: readonly TuiModel[],
): acp.SessionConfigOption | undefined {
  const values = uniqueModelValues(models);
  if (values.length === 0) return undefined;
  const persistedSelection = selectedModel(session, models);
  if (
    persistedSelection &&
    !values.some(
      ({ selection }) => modelConfigValue(selection) === modelConfigValue(persistedSelection),
    )
  ) {
    return undefined;
  }
  const selected = persistedSelection ?? values[0]?.selection;
  if (!selected) return undefined;
  return {
    type: 'select',
    id: ACP_CONFIG_MODEL,
    name: 'Model',
    description: 'Selects the model used by subsequent turns in this Session.',
    category: 'model',
    currentValue: modelConfigValue(selected),
    // **The limits and the ladder ride along, because nothing else can tell the
    // client what they are.** A client's model screen knows an id and a name and
    // nothing more — the window is only ever stated on a usage update, which
    // needs a session already running the model, and the levels only on the
    // `thinkingEffort` option, which states them for the running model alone —
    // so an app with no other source draws its own fallback, and a row reads
    // `200k` for a model that runs at a million. `_meta` is the protocol's own
    // room for that.
    options: values.map(
      ({ selection, name, contextLimit, maxOutputTokens, effortOptions, effortDefault }) => ({
        value: modelConfigValue(selection),
        name,
        ...(contextLimit === undefined &&
        maxOutputTokens === undefined &&
        !effortOptions?.length
          ? {}
          : {
              _meta: {
                ...(contextLimit !== undefined ? { contextWindow: contextLimit } : {}),
                ...(maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}),
                ...(effortOptions?.length ? { effortOptions: [...effortOptions] } : {}),
                ...(effortDefault !== undefined ? { defaultEffort: effortDefault } : {}),
              },
            }),
      }),
    ),
  };
}

function thinkingEffortOption(
  session: TuiSession,
  models: readonly TuiModel[],
): acp.SessionConfigOption | undefined {
  const selected = selectedModel(session, models);
  if (!selected) return undefined;
  const model = models.find(
    (candidate) =>
      candidate.providerId === selected.providerId &&
      candidate.modelId === selected.modelId &&
      modelSupportsVariant(candidate, selected.variant),
  );
  const efforts = model?.effortOptions ?? [];
  if (efforts.length === 0) return undefined;
  const persistedEffort = session.model?.thinking?.effort;
  if (persistedEffort && !efforts.includes(persistedEffort)) return undefined;
  const current = persistedEffort ?? defaultEffortFor(model);
  if (!current) return undefined;
  return {
    type: 'select',
    id: ACP_CONFIG_THINKING_EFFORT,
    name: 'Thinking effort',
    description: 'Controls the reasoning effort for the selected model in this Session.',
    category: 'thought_level',
    currentValue: current,
    options: efforts.map((effort) => ({ value: effort, name: labelEffort(effort) })),
  };
}

/// The level a model lands on when nothing asks for one: its own default where
/// the catalog states one the ladder carries, else the ladder's floor.
///
/// One rule with two readers — the session's `thinkingEffort` option and the
/// `_meta` of every model row — because a client drawing a level the agent would
/// not pick is a switch that reads as set and is not.
function defaultEffortFor(model: TuiModel | undefined): string | undefined {
  const efforts = model?.effortOptions ?? [];
  if (efforts.length === 0) return undefined;
  const configured = model?.thinkingConfig?.defaultValue;
  return configured && efforts.includes(configured) ? configured : efforts[0];
}

function uniqueModelValues(models: readonly TuiModel[]): Array<{
  readonly selection: {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
  };
  readonly name: string;
  readonly contextLimit?: number;
  readonly maxOutputTokens?: number;
  readonly effortOptions?: readonly string[];
  readonly effortDefault?: string;
}> {
  const seen = new Set<string>();
  const values = [];
  for (const model of models) {
    const effortDefault = defaultEffortFor(model);
    const variants = model.supportedVariants?.length
      ? model.supportedVariants
      : [model.variant].filter((variant): variant is string => variant !== undefined);
    const selections: Array<{ providerId: string; modelId: string; variant?: string }> =
      variants.length > 0
        ? variants.map((variant) => ({
            providerId: model.providerId,
            modelId: model.modelId,
            variant,
          }))
        : [{ providerId: model.providerId, modelId: model.modelId }];
    for (const selection of selections) {
      const value = modelConfigValue(selection);
      if (seen.has(value)) continue;
      seen.add(value);
      values.push({
        selection,
        name: `${model.displayName ?? model.modelId}${selection.variant ? ` · ${selection.variant}` : ''}`,
        ...(typeof model.contextLimit === 'number' ? { contextLimit: model.contextLimit } : {}),
        ...(typeof model.maxOutputTokens === 'number'
          ? { maxOutputTokens: model.maxOutputTokens }
          : {}),
        // **The ladder and its default travel per row, because no other channel
        // carries them.** The `thinkingEffort` option states the levels of the
        // model the session *runs* — a client drawing only that has one row with
        // levels and every other row bare, which reads as a model that takes no
        // effort at all. Published beside the window, on the same `_meta`, where a
        // client is already reading the per-model facts it cannot ask for.
        ...(model.effortOptions?.length ? { effortOptions: [...model.effortOptions] } : {}),
        ...(effortDefault !== undefined ? { effortDefault } : {}),
      });
    }
  }
  return values;
}

function selectedModel(
  session: TuiSession,
  models: readonly TuiModel[],
): { providerId: string; modelId: string; variant?: string } | undefined {
  if (session.model?.providerId && session.model.modelId) {
    return {
      providerId: session.model.providerId,
      modelId: session.model.modelId,
      ...(session.model.variant !== undefined ? { variant: session.model.variant } : {}),
    };
  }
  const selected = models.find((model) => model.selected);
  return selected
    ? {
        providerId: selected.providerId,
        modelId: selected.modelId,
        ...(selected.variant !== undefined ? { variant: selected.variant } : {}),
      }
    : undefined;
}

function labelEffort(value: string): string {
  return value.length > 0 ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}
