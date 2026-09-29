import type {
  McodeCodexOAuthStartResult,
  McodeCodexOAuthLoginOptions,
  McodeCodexOAuthStatus,
  McodeCreateProviderInput,
  McodeDiscoverProviderModelsInput,
  McodeMiniMaxModelSource,
  McodeProviderRuntimePort,
  McodeProviderModelInput,
  McodeSaveProviderCandidateInput,
  McodeSaveProviderCandidateResult,
  McodeProviderSnapshot,
  McodeProviderTestResult,
  McodeProviderView,
  McodeRuntimeProviderView,
  McodeUpdateProviderInput,
} from './contract.js';
import { isModelProviderApiFormat } from './contract.js';

export class McodeProviderApplication {
  constructor(private readonly port: McodeProviderRuntimePort) {}

  async snapshot(
    options: { readonly includeCodexOAuth?: boolean } = {},
  ): Promise<McodeProviderSnapshot> {
    const [customProviders, minimaxStatus, minimaxModelSource, codexOAuthStatus] =
      await Promise.all([
        this.port.listUserModelProviders(),
        this.port.getMiniMaxApiKeyStatus(),
        this.port.getMiniMaxModelSource(),
        options.includeCodexOAuth ? this.port.getCodexOAuthStatus() : undefined,
      ]);
    return {
      minimaxModelSource,
      providers: [
        ...(!codexOAuthStatus || codexOAuthStatus.state === 'hidden'
          ? []
          : [normalizeCodexOAuthProvider(codexOAuthStatus)]),
        {
          providerId: 'minimax_oauth',
          name: 'MiniMax OAuth',
          kind: 'minimax-oauth',
          active: minimaxModelSource === 'token_plan',
          enabled: true,
          readOnly: true,
          hasApiKey: false,
          models: [],
        },
        {
          providerId: 'minimax_api',
          name: 'MiniMax API Key',
          kind: 'minimax-api-key',
          active: minimaxModelSource === 'minimax_api_key',
          enabled: true,
          readOnly: false,
          hasApiKey: minimaxStatus.hasApiKey,
          ...(minimaxStatus.maskedApiKey ? { maskedApiKey: minimaxStatus.maskedApiKey } : {}),
          ...(minimaxStatus.cachedStatus ? { status: minimaxStatus.cachedStatus } : {}),
          models: [],
        },
        ...customProviders.map(normalizeCustomProvider),
      ],
    };
  }

  setMiniMaxSource(source: McodeMiniMaxModelSource): Promise<McodeMiniMaxModelSource> {
    return this.port.setMiniMaxModelSource(source);
  }

  connectCodexOAuth(options?: McodeCodexOAuthLoginOptions): Promise<McodeCodexOAuthStartResult> {
    return this.port.startCodexOAuthLogin(options);
  }

  getCodexOAuthStatus(): Promise<McodeCodexOAuthStatus> {
    return this.port.getCodexOAuthStatus();
  }

  cancelCodexOAuthLogin(loginId: string): Promise<McodeCodexOAuthStatus> {
    return this.port.cancelCodexOAuthLogin(loginId);
  }

  async setMiniMaxApiKey(apiKey: string, saveAndUse = true): Promise<void> {
    await this.port.upsertMiniMaxApiKey({ apiKey, saveAndUse });
  }

  async create(input: McodeCreateProviderInput): Promise<void> {
    await this.port.createUserModelProvider(input);
  }

  saveCandidate(input: McodeSaveProviderCandidateInput): Promise<McodeSaveProviderCandidateResult> {
    return this.port.saveUserModelProviderCandidate(input);
  }

  /// Asks this provider's own list endpoint and adds whatever it has that the
  /// saved configuration does not.
  async refreshModels(provider: McodeProviderView): Promise<number> {
    const candidate = editableCandidate(provider);
    const discovered = await this.port.discoverUserModelsCandidate(candidate);
    return saveNewModels(this.port, provider, candidate, discovered);
  }

  /// Adds the models named, and asks nothing.
  ///
  /// **For a caller that has already done the asking.** Which of a gateway's
  /// rows this build can run is not a fact the discovery knows — a list endpoint
  /// answers every wire a gateway serves, and a model registered on the wrong
  /// one is refused at the end of its first turn — so an ACP client that
  /// resolves the list itself adds only the rows it kept.
  async addModels(provider: McodeProviderView, modelIds: readonly string[]): Promise<number> {
    const candidate = editableCandidate(provider);
    return saveNewModels(
      this.port,
      provider,
      candidate,
      modelIds.map((modelId) => ({ modelId })),
    );
  }

  async update(input: McodeUpdateProviderInput): Promise<void> {
    await this.port.updateUserModelProvider(input);
  }

  async remove(providerId: string): Promise<void> {
    await this.port.deleteUserModelProvider(providerId);
  }

  test(providerId: string, modelId?: string): Promise<McodeProviderTestResult> {
    return modelId
      ? this.port.testUserModel(providerId, modelId)
      : this.port.testUserModelProvider(providerId);
  }
}

/// The provider as a candidate the runtime will accept, or the refusal.
///
/// **The revision is what makes an add safe.** The reader may have edited this
/// same provider in a terminal while the list was being read, and a save that
/// does not name the revision it read would write over that edit.
function editableCandidate(provider: McodeProviderView): McodeDiscoverProviderModelsInput {
  if (
    provider.kind !== 'custom' ||
    provider.readOnly ||
    !provider.baseUrl ||
    !provider.configRevision
  ) {
    throw new Error('Reopen /provider and select an editable connection.');
  }
  return {
    providerId: provider.providerId,
    expectedRevision: provider.configRevision,
    baseUrl: provider.baseUrl,
  };
}

/// Saves `discovered` onto the provider, and answers with how many were new.
///
/// **One save, and it carries the whole list.** The candidate path replaces the
/// saved set, so a model left out of this call is a model dropped from the
/// provider: the rows already there go back in untouched and in their own order,
/// and only the new ones are marked `discovered`. That mark is also what a
/// reader can undo without losing a limit or a display name, since every saved
/// field of an existing id rides through as it was.
async function saveNewModels(
  port: McodeProviderRuntimePort,
  provider: McodeProviderView,
  candidate: McodeDiscoverProviderModelsInput,
  discovered: readonly McodeProviderModelInput[],
): Promise<number> {
  const ids = new Set(provider.models.map(({ modelId }) => modelId));
  const added = discovered
    .map(({ modelId, displayName }) => ({
      modelId: modelId.trim(),
      ...(displayName ? { displayName } : {}),
    }))
    .filter(({ modelId }) => {
      if (!modelId || ids.has(modelId)) return false;
      ids.add(modelId);
      return true;
    });
  const firstAdded = added[0];
  if (!firstAdded) return 0;
  const result = await port.saveUserModelProviderCandidate({
    ...candidate,
    // IDs retain every saved model field, including disabled state and limits.
    models: [
      ...provider.models.map(({ modelId }) => ({ modelId })),
      ...added.map((model) => ({ ...model, configurationSource: 'discovered' as const })),
    ],
    modelId: firstAdded.modelId,
    skipConnectionTest: true,
    saveAndUse: false,
  });
  if (!result.success)
    throw new Error(result.status?.lastErrorMessage ?? 'Could not save refreshed models.');
  return added.length;
}

function normalizeCodexOAuthProvider(status: McodeCodexOAuthStatus): McodeProviderView {
  return {
    providerId: status.providerId,
    name: 'OpenAI Codex',
    kind: 'codex-oauth',
    active: false,
    enabled: true,
    readOnly: true,
    hasApiKey: false,
    models: [],
    status: {
      state: status.state,
      ...(status.error ? { lastErrorMessage: status.error } : {}),
    },
  };
}

function normalizeCustomProvider(provider: McodeRuntimeProviderView): McodeProviderView {
  const apiFormat = isModelProviderApiFormat(provider.apiFormat) ? provider.apiFormat : undefined;
  return {
    providerId: provider.providerId,
    name: provider.name?.trim() || provider.providerId,
    kind: 'custom',
    // A disabled provider is never "in use": Runtime drops it from the model
    // roster (`enabledCustomProviders`) and BYOK resolution refuses it, so a
    // leftover `selected` model must not render as the active source.
    active: Boolean(
      provider.enabled !== false &&
      provider.models?.some((model) => 'selected' in model && model.selected),
    ),
    enabled: provider.enabled !== false,
    readOnly: provider.kind === 'oauth',
    ...(provider.configRevision ? { configRevision: provider.configRevision } : {}),
    ...(apiFormat ? { apiFormat } : {}),
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    hasApiKey: Boolean(provider.hasApiKey),
    ...(provider.maskedApiKey ? { maskedApiKey: provider.maskedApiKey } : {}),
    models: (provider.models ?? []).map((model) => ({
      modelId: model.modelId,
      ...(model.displayName ? { displayName: model.displayName } : {}),
      ...(model.selected !== undefined ? { selected: model.selected } : {}),
      ...(model.contextLimit !== undefined ? { contextLimit: model.contextLimit } : {}),
      ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
      ...(model.status ? { status: model.status } : {}),
    })),
    ...(provider.status ? { status: provider.status } : {}),
  };
}

export type {
  McodeCreateProviderInput,
  McodeProviderRuntimePort,
  McodeProviderSnapshot,
  McodeUpdateProviderInput,
} from './contract.js';
