import { isLegacyManagedMinimaxProvider } from "@hz/config";
import {
  normalizeTuiPermissionMode,
  type TuiPermissionMode,
} from "../../application/permission-mode.js";
import type {
  TuiAccountStatus,
  TuiAccountStatusOptions,
  TuiActiveRunSnapshot,
  TuiAgent,
  TuiAgentDetail,
  TuiAgentDraft,
  TuiCompactionResult,
  TuiConfiguredMcpConfig,
  TuiConfiguredMcpServer,
  TuiConfiguredMcpServerDetail,
  TuiContextSnapshotResponse,
  TuiInstructionSource,
  TuiMcpServer,
  TuiMcpTestResult,
  TuiProjectMcpPreview,
  TuiModel,
  TuiModelSelection,
  TuiRuntimeDiagnostics,
  TuiSessionUsage,
  TuiSessionUsageSummary,
  TuiSkillList,
} from "../port.js";
import type { TuiRuntimeAccessContext } from "./access-context.js";
import type {
  McodeCreateProviderInput,
  McodeCodexOAuthStartResult,
  McodeCodexOAuthLoginOptions,
  McodeCodexOAuthStatus,
  McodeMiniMaxModelSource,
  McodeProviderTemplate,
  McodeProviderTestResult,
  McodeRuntimeProviderView,
  McodeSaveProviderCandidateInput,
  McodeSaveProviderCandidateResult,
  McodeUpdateProviderInput,
} from "../../provider/contract.js";
import {
  normalizeAccountStatus,
  normalizeRuntimeDiagnostics,
} from "./normalizers.js";
import { projectTuiContextSnapshot } from "../projections/context-snapshot.js";

/// The roster is read in one page, and this is the page.
///
/// A management screen has to draw every Skill — that is what makes a switch
/// findable again — so the read is deliberately wide rather than paged. `hasMore`
/// rides the answer, so the count on screen is never a quiet lie about a machine
/// that somehow holds more than this.
const SKILL_ROSTER_LIMIT = 500;

export class TuiProductAccess {
  constructor(
    private readonly context: TuiRuntimeAccessContext,
    private readonly defaultAgentName: string,
    private readonly workspaceDir?: string,
  ) {}

  async getAccountStatus(
    sessionId?: string,
    options?: TuiAccountStatusOptions,
  ): Promise<TuiAccountStatus> {
    return normalizeAccountStatus(
      await this.context.service("runtime.account").getAccountStatus({
        ...(sessionId ? { sessionId } : {}),
        ...(options?.model
          ? { model: `${options.model.providerId}/${options.model.modelId}` }
          : {}),
      }),
    );
  }

  async getRuntimeDiagnostics(): Promise<TuiRuntimeDiagnostics> {
    return normalizeRuntimeDiagnostics(
      await this.context.service("runtime.diagnostics").getRuntimeDiagnostics(),
    );
  }

  getInstructionSources(
    workspaceDir: string,
  ): Promise<readonly TuiInstructionSource[]> {
    return this.context
      .service("runtime.instructions")
      .getInstructionSources({ workspaceDir });
  }

  async getPermissionMode(): Promise<TuiPermissionMode | undefined> {
    return normalizeTuiPermissionMode(
      await this.context.service("config.permission.read").getPermissionMode(),
    );
  }

  async setPermissionMode(mode: TuiPermissionMode): Promise<TuiPermissionMode> {
    return (
      normalizeTuiPermissionMode(
        await this.context
          .service("config.permission.write")
          .setPermissionMode({ mode }),
      ) ?? mode
    );
  }

  async listModels(sessionId?: string): Promise<TuiModel[]> {
    const service = this.context.service("model.list");
    const request = { ...(sessionId ? { sessionId } : {}) };
    return (await service.listModels(request)).map(projectTuiModelCatalogEntry);
  }

  async selectModel(
    model: TuiModelSelection,
    sessionId?: string,
  ): Promise<boolean> {
    const service = this.context.service("model.select");
    const request = modelRequest(model);
    if (!sessionId) return service.selectModel(request);

    const savedAsDefault = await service.selectModel(request);
    if (!savedAsDefault) return false;
    return this.selectSessionModel(model, sessionId);
  }

  selectSessionModel(
    model: TuiModelSelection,
    sessionId: string,
  ): Promise<boolean> {
    return this.context.service("model.select").selectModel({
      ...modelRequest(model),
      sessionId,
    });
  }

  async listUserModelProviders(): Promise<readonly McodeRuntimeProviderView[]> {
    const providers = (await this.context
      .service("provider.list")
      .listUserModelProviders()) as unknown as readonly McodeRuntimeProviderView[];
    return providers.filter(
      (provider) =>
        !isLegacyManagedMinimaxProvider(provider.providerId, provider.baseUrl),
    );
  }

  async listProviderPresets(): Promise<readonly McodeProviderTemplate[]> {
    return (await this.context
      .service("provider.presets")
      .listProviderPresets()) as readonly McodeProviderTemplate[];
  }

  async getCodexOAuthStatus(): Promise<McodeCodexOAuthStatus> {
    return (await this.context
      .service("provider.codex-oauth.status")
      .getCodexOAuthStatus()) as McodeCodexOAuthStatus;
  }

  async startCodexOAuthLogin(
    options?: McodeCodexOAuthLoginOptions,
  ): Promise<McodeCodexOAuthStartResult> {
    return (await this.context
      .service("provider.codex-oauth.start")
      .startCodexOAuthLogin(options)) as McodeCodexOAuthStartResult;
  }

  async cancelCodexOAuthLogin(loginId: string): Promise<McodeCodexOAuthStatus> {
    return (await this.context
      .service("provider.codex-oauth.cancel")
      .cancelCodexOAuthLogin(loginId)) as McodeCodexOAuthStatus;
  }

  async getMiniMaxApiKeyStatus(): Promise<{
    readonly hasApiKey: boolean;
    readonly maskedApiKey?: string;
    readonly cachedStatus?: McodeProviderTestResult["status"];
  }> {
    return (await this.context
      .service("provider.minimax.status")
      .getMiniMaxApiKeyStatus()) as {
      hasApiKey: boolean;
      maskedApiKey?: string;
      cachedStatus?: McodeProviderTestResult["status"];
    };
  }

  getMiniMaxModelSource(): Promise<McodeMiniMaxModelSource> {
    return this.context
      .service("provider.minimax.source")
      .getMiniMaxModelSource();
  }

  setMiniMaxModelSource(
    source: McodeMiniMaxModelSource,
  ): Promise<McodeMiniMaxModelSource> {
    return this.context
      .service("provider.minimax.source")
      .setMiniMaxModelSource({ source });
  }

  async upsertMiniMaxApiKey(input: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }): Promise<void> {
    await this.context
      .service("provider.minimax.upsert")
      .upsertMiniMaxApiKey(input);
  }

  async createUserModelProvider(
    input: McodeCreateProviderInput,
  ): Promise<void> {
    await this.context.service("provider.create").createUserModelProvider({
      ...input,
      models: [...input.models],
    });
  }

  discoverUserModelsCandidate(
    input: import("../../provider/contract.js").McodeDiscoverProviderModelsInput,
  ) {
    return this.context
      .service("provider.discover")
      .discoverUserModelsCandidate(input);
  }

  async saveUserModelProviderCandidate({
    modelId,
    saveAndUse,
    skipConnectionTest,
    ...candidate
  }: McodeSaveProviderCandidateInput): Promise<McodeSaveProviderCandidateResult> {
    return (await this.context
      .service("provider.save-candidate")
      .saveUserModelProviderCandidate({
        candidate: {
          ...candidate,
          ...(candidate.models
            ? { models: candidate.models.map((model) => ({ ...model })) }
            : {}),
        },
        modelId,
        ...(skipConnectionTest !== undefined ? { skipConnectionTest } : {}),
        ...(saveAndUse !== undefined ? { saveAndUse } : {}),
      })) as McodeSaveProviderCandidateResult;
  }

  async updateUserModelProvider(
    input: McodeUpdateProviderInput,
  ): Promise<void> {
    await this.context.service("provider.update").updateUserModelProvider({
      ...input,
      ...(input.models ? { models: [...input.models] } : {}),
    });
  }

  async deleteUserModelProvider(providerId: string): Promise<void> {
    await this.context
      .service("provider.delete")
      .deleteUserModelProvider({ providerId });
  }

  async testUserModelProvider(
    providerId: string,
  ): Promise<McodeProviderTestResult> {
    return (await this.context
      .service("provider.test")
      .testUserModelProvider({ providerId })) as McodeProviderTestResult;
  }

  async testUserModel(
    providerId: string,
    modelId: string,
  ): Promise<McodeProviderTestResult> {
    return (await this.context
      .service("provider.test-model")
      .testUserModel({ providerId, modelId })) as McodeProviderTestResult;
  }

  async getSessionUsage(sessionId: string): Promise<TuiSessionUsage> {
    const response = await this.context
      .service("session.usage")
      .getSessionUsage({ id: sessionId });
    return {
      summary: response.summary,
      rows: response.rows,
    } as TuiSessionUsage;
  }

  async getSessionUsageSummary(
    sessionId: string,
  ): Promise<TuiSessionUsageSummary> {
    return (await this.context
      .service("session.usage-summary")
      .getSessionUsageSummary({ id: sessionId })) as TuiSessionUsageSummary;
  }

  async requestCompaction(
    sessionId: string,
    agentName = this.defaultAgentName,
    customInstructions?: string,
  ): Promise<TuiCompactionResult> {
    const response = await this.context
      .service("session.compaction")
      .requestCompaction({
        name: agentName,
        id: sessionId,
        reason: "ui_request",
        ...(customInstructions ? { customInstructions } : {}),
      });
    return {
      ...response,
      ...(response.tokensBefore !== undefined
        ? { tokensBefore: Number(response.tokensBefore) }
        : {}),
      ...(response.tokensAfter !== undefined
        ? { tokensAfter: Number(response.tokensAfter) }
        : {}),
    };
  }

  async getContextSnapshot(
    sessionId: string,
  ): Promise<TuiContextSnapshotResponse> {
    const service = this.context.service("session.context-snapshot");
    const [sessionResponse, messagesResponse, models] = await Promise.all([
      service.getSession({ id: sessionId }),
      service.getMessages({ id: sessionId, limit: 80 }),
      service.listModels({ sessionId }) as Promise<readonly TuiModel[]>,
    ]);
    const session = sessionResponse.session;
    if (!session)
      throw new Error(`Runtime did not return Session ${sessionId}.`);
    const selected = models.find((model) => model.selected === true);
    const model =
      selected &&
      (selected.providerId !== session.model?.providerId ||
        selected.modelId !== session.model?.modelId)
        ? selected
        : (session.model ?? selected);
    return projectTuiContextSnapshot({
      messages: messagesResponse.messages ?? [],
      active: session.status?.statusType === 1,
      model,
    });
  }

  async getActiveRun(sessionId: string): Promise<TuiActiveRunSnapshot> {
    const service = this.context.service("session.active-run");
    const sessionResponse = await service.getSession({ id: sessionId });
    const session = sessionResponse.session;
    if (!session)
      throw new Error(`Runtime did not return Session ${sessionId}.`);
    const started = session.status?.statusType === 1;
    const [activeTurn, permissions, questionnaire] = started
      ? await Promise.all([
          service.getActiveTurn(sessionId),
          service.listPendingPermissions({}),
          service.getPendingQuestionnaire({
            name: session.agentName ?? this.defaultAgentName,
            sessionId,
          }),
        ])
      : [undefined, { requests: [] }, {}];
    const decisionBlocked =
      started &&
      (questionnaire.request !== undefined ||
        (permissions.requests ?? []).some(
          (request) => request.sessionId === sessionId,
        ));
    const turnId = activeTurn?.turnId;
    const steerable =
      started &&
      !decisionBlocked &&
      activeTurn?.busyReason === "turn" &&
      activeTurn.locallyOwned;
    return {
      schemaVersion: 1,
      sessionId,
      state: started
        ? decisionBlocked
          ? "decision-blocked"
          : "running"
        : session.status?.statusType === 2 || session.status?.statusType === 3
          ? "terminal"
          : "idle",
      ...(turnId ? { turnId } : {}),
      actions: { steer: steerable },
    };
  }

  async listSkills(
    agentName = this.defaultAgentName,
    keyword?: string,
  ): Promise<TuiSkillList> {
    const service = this.context.service("skill.list");
    const result = await service.listRuntimeSkills({
      agentName,
      ...(this.workspaceDir ? { workspaceDir: this.workspaceDir } : {}),
      includePluginSkills: true,
    });
    const normalizedKeyword = keyword?.trim().toLocaleLowerCase();
    const skills = normalizedKeyword
      ? (result.skills ?? []).filter((skill) =>
          `${skill.name} ${skill.displayName ?? ""} ${skill.description ?? ""}`
            .toLocaleLowerCase()
            .includes(normalizedKeyword),
        )
      : (result.skills ?? []);
    return { skills, hasMore: false };
  }

  /// Switches one Skill on or off, answering whether the registry took it.
  ///
  /// **`true` means "applied", not "on".** The registry answers `undefined` for a
  /// Skill it does not recognise, and that is the honest answer rather than a
  /// throw — the row the reader pressed may have been deleted since it was drawn.
  ///
  /// `locationUri` is passed through where the caller has it; see the port's own
  /// note on why a name alone is not enough.
  async setSkillEnabled(
    skillName: string,
    enabled: boolean,
    locationUri?: string,
  ): Promise<boolean> {
    const result = await this.context.service("skill.set-enabled").setSkillEnabled(
      {
        skillName,
        agentName: this.defaultAgentName,
        ...(locationUri ? { locationUri } : {}),
        ...(this.workspaceDir ? { workspaceDir: this.workspaceDir } : {}),
      },
      enabled,
    );
    return result !== undefined;
  }

  /// The whole roster, Skills that are switched off included.
  ///
  /// **Not `listSkills`, and the difference is the whole reason this exists.**
  /// `listSkills` answers the *runtime* list — what the model is told about — and
  /// the registry filters a switched-off Skill out of it, so a screen built on
  /// that could never draw the row that turns one back on. This reads the same
  /// management view the app's own "My skills" reads, which keeps every Skill and
  /// marks each one as on or off.
  async listAllSkills(agentName = this.defaultAgentName): Promise<TuiSkillList> {
    const result = await this.context.service("skill.roster").listSkills({
      agentName,
      limit: SKILL_ROSTER_LIMIT,
      ...(this.workspaceDir ? { workspaceDir: this.workspaceDir } : {}),
    });
    return { skills: result.skills ?? [], hasMore: result.hasMore };
  }

  /// One Skill's own text, read through the registry that owns it.
  ///
  /// `undefined` is an answer rather than a failure: the row may have been
  /// deleted between the list and the press, and a client that got a throw there
  /// would have to tell the two apart by reading a message.
  async readSkill(skillName: string, locationUri?: string): Promise<string | undefined> {
    const detail = await this.context.service("skill.read").getSkill(
      {
        skillName,
        agentName: this.defaultAgentName,
        ...(locationUri ? { locationUri } : {}),
        ...(this.workspaceDir ? { workspaceDir: this.workspaceDir } : {}),
      },
      { includeBody: true },
    );
    return detail?.content;
  }

  inspectProjectMcp(
    sessionId: string,
  ): Promise<TuiProjectMcpPreview | undefined> {
    return this.context
      .service("mcp.project.inspect")
      .inspectProjectMcp(sessionId);
  }

  /// Every Agent definition this machine holds, the built-in roles included.
  ///
  /// **One page, like the Skill roster and for the same reason**: a screen that
  /// manages Agents has to draw all of them, so a second page nobody turns is a
  /// row the reader cannot reach. The store answers far fewer rows than the
  /// roster's cap.
  async listAgents(
    input: { search?: string; limit?: number; offset?: number } = {},
  ): Promise<readonly TuiAgent[]> {
    const agents = await this.context.service("agent.list").listAgents(input);
    return agents.map(toTuiAgent);
  }

  /// One Agent with its stored prompt, or `undefined` for one that is gone.
  async getAgent(name: string): Promise<TuiAgentDetail | undefined> {
    const detail = await this.context.service("agent.get").getAgent(name);
    return detail ? toTuiAgentDetail(detail) : undefined;
  }

  /// Writes a new Agent definition down, and answers what was stored.
  async createAgent(input: TuiAgentDraft): Promise<TuiAgentDetail> {
    const created = await this.context.service("agent.create").createAgent({
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
      ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
      ...(input.persona !== undefined ? { persona: input.persona } : {}),
      ...(input.initialDefinition ? { initialDefinition: input.initialDefinition } : {}),
    });
    // Read back rather than assembled from the draft: the store resolves the
    // exact name and the `requestRef` a later press has to address, and neither
    // is derivable here — a name colliding with a reserved role is filed under
    // `agent:<name>`.
    const detail = await this.context.service("agent.get").getAgent(created.requestRef);
    if (!detail) throw new Error(`The Agent ${created.name} was not readable after it was written.`);
    return toTuiAgentDetail(detail);
  }

  /// Rewrites an Agent's identity and prompt. Absent fields are left as stored.
  async updateAgent(name: string, input: TuiAgentDraft): Promise<TuiAgentDetail> {
    await this.context.service("agent.update").updateAgent({
      requestRef: name,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
      ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
      ...(input.persona !== undefined ? { persona: input.persona } : {}),
    });
    const detail = await this.context.service("agent.get").getAgent(name);
    if (!detail) throw new Error(`The Agent ${name} was not readable after it was written.`);
    return toTuiAgentDetail(detail);
  }

  /// Removes an Agent definition, answering whether the store took it.
  ///
  /// A store that refuses — an Agent that is gone, or a built-in that cannot be
  /// deleted — throws, and that sentence is what the client draws. `true` here
  /// means the removal landed, which is the only success there is.
  async deleteAgent(name: string): Promise<boolean> {
    await this.context.service("agent.delete").deleteAgent(name);
    return true;
  }
  async listMcpServers(
    keyword?: string,
    sessionId?: string,
  ): Promise<TuiMcpServer[]> {
    const request = {
      ...(keyword ? { keyword } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
    const result = await this.context
      .service("mcp.list")
      .listMcpServers(request);
    return result.servers as TuiMcpServer[];
  }

  /// The reader's own MCP store — every server written down, off ones included.
  ///
  /// See the port's own note for why this is not `listMcpServers` above: that one
  /// is what a session can reach, and a server switched off is simply absent from
  /// it.
  async listConfiguredMcpServers(keyword?: string): Promise<TuiConfiguredMcpServer[]> {
    const servers = await this.context
      .service("mcp.configured.list")
      .listConfiguredMcpServers(keyword);
    return servers as TuiConfiguredMcpServer[];
  }

  /// One server's configuration, which is the only read carrying `env`/`headers`.
  ///
  /// The agent's own union is handed back as the form's flat shape rather than
  /// being taken apart and put together again: every field of either transport is
  /// optional there, so the union already *is* that shape.
  async getConfiguredMcpServer(
    name: string,
  ): Promise<TuiConfiguredMcpServerDetail | undefined> {
    const detail = await this.context
      .service("mcp.configured.get")
      .getConfiguredMcpServer(name);
    return detail ? { name: detail.name, enabled: detail.enabled, config: detail.config } : undefined;
  }

  async createConfiguredMcpServer(
    name: string,
    config: TuiConfiguredMcpConfig,
  ): Promise<TuiConfiguredMcpServerDetail> {
    const detail = await this.context
      .service("mcp.configured.create")
      .createConfiguredMcpServer(name, toConfiguredInput(config));
    return { name: detail.name, enabled: detail.enabled, config: detail.config };
  }

  async updateConfiguredMcpServer(
    name: string,
    config: TuiConfiguredMcpConfig,
  ): Promise<TuiConfiguredMcpServerDetail> {
    const detail = await this.context
      .service("mcp.configured.update")
      .updateConfiguredMcpServer(name, toConfiguredInput(config));
    return { name: detail.name, enabled: detail.enabled, config: detail.config };
  }

  async deleteConfiguredMcpServer(name: string): Promise<boolean> {
    return this.context
      .service("mcp.configured.delete")
      .deleteConfiguredMcpServer(name);
  }

  async setConfiguredMcpServerEnabled(
    name: string,
    enabled: boolean,
  ): Promise<TuiConfiguredMcpServer> {
    return this.context
      .service("mcp.configured.toggle")
      .setConfiguredMcpServerEnabled(name, enabled);
  }

  async testConfiguredMcpServer(name: string): Promise<TuiMcpTestResult> {
    return this.context
      .service("mcp.configured.test")
      .testConfiguredMcpServer(name);
  }
}

/// The agent's own union, narrowed from the form's flat shape.
///
/// **Here rather than on the wire, because this is where the two vocabularies
/// meet.** A form holds one object with the fields of both transports — it
/// switches between them and the fields follow — while the agent's type says a
/// stdio server has no `url` and a remote one has no `command`. Narrowing at this
/// boundary is what makes that a rule rather than a hope: the fields the transport
/// does not use are dropped instead of being sent and quietly ignored.
///
/// A blank field is dropped rather than sent: the agent refuses an empty command
/// or URL, and "this one is still empty" is the form's sentence to say, not
/// something for the reader to discover as a refusal.
function toConfiguredInput(config: TuiConfiguredMcpConfig) {
  const shared = {
    ...(config.timeoutMs && config.timeoutMs > 0 ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.description?.trim() ? { description: config.description.trim() } : {}),
  };
  const args = config.args?.filter((arg) => arg.trim().length > 0);
  const env = filledEntries(config.env);
  const headers = filledEntries(config.headers);

  if (config.transport === 'stdio') {
    return {
      transport: 'stdio' as const,
      command: config.command?.trim() ?? '',
      ...(args?.length ? { args } : {}),
      ...(env ? { env } : {}),
      ...shared,
    };
  }

  return {
    transport: config.transport,
    url: config.url?.trim() ?? '',
    ...(headers ? { headers } : {}),
    ...shared,
  };
}

/// A key/value map with blank keys and blank values taken out.
///
/// The agent refuses a map with an empty key, and a reader part-way through typing
/// one has that on screen the whole time — so a half-written entry is dropped here
/// rather than failing a save the reader cannot see the reason for.
function filledEntries(
  map: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!map) return undefined;
  const kept = Object.entries(map).filter(([key, value]) => key.trim() && value.trim());
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

function modelRequest(model: TuiModelSelection): {
  providerId: string;
  modelId: string;
  variant?: string;
  contextLimit?: number;
  thinking?: TuiModelSelection["thinking"];
} {
  const effort = model.thinking?.effort?.trim();
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    ...(model.variant !== undefined ? { variant: model.variant } : {}),
    ...(model.contextLimit !== undefined
      ? { contextLimit: model.contextLimit }
      : {}),
    ...(effort ? { thinking: { effort } } : {}),
  };
}

function projectTuiModelCatalogEntry(input: unknown): TuiModel {
  const model = input as TuiModel & {
    readonly thinkingConfig?: TuiModel["thinkingConfig"] & {
      readonly default_value?: string;
    };
  };
  const thinkingConfig = model.thinkingConfig;
  if (!thinkingConfig) return model;
  const { default_value: defaultValueSnakeCase, ...fields } = thinkingConfig;
  return {
    ...model,
    thinkingConfig: {
      ...fields,
      ...(fields.defaultValue !== undefined
        ? { defaultValue: fields.defaultValue }
        : defaultValueSnakeCase !== undefined
          ? { defaultValue: defaultValueSnakeCase }
          : {}),
    },
  };
}

/// One store row narrowed to what a client draws.
///
/// The store answers more than a listing needs — canonical names, a resolved
/// agent name, the config directory, a legacy source — and none of it is
/// something a row can show. What is kept is the identity line and the two facts
/// a client files by: the role it plays and where it came from.
function toTuiAgent(agent: {
  name: string;
  displayName: string;
  description?: string;
  avatar?: string;
  agentRole: string;
  creationSource: string;
}): TuiAgent {
  return {
    name: agent.name,
    // A row with no label still needs one, and the store's own name is the only
    // other thing it could be.
    displayName: agent.displayName || agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.avatar ? { avatar: agent.avatar } : {}),
    agentRole: agent.agentRole,
    creationSource: agent.creationSource,
  };
}

/// The same row with its prompt, for the one read that carries content.
function toTuiAgentDetail(agent: {
  name: string;
  displayName: string;
  description?: string;
  avatar?: string;
  agentRole: string;
  creationSource: string;
  systemPrompt?: string;
  persona?: string;
}): TuiAgentDetail {
  return {
    agent: toTuiAgent(agent),
    ...(agent.systemPrompt !== undefined ? { systemPrompt: agent.systemPrompt } : {}),
    ...(agent.persona !== undefined ? { persona: agent.persona } : {}),
  };
}
