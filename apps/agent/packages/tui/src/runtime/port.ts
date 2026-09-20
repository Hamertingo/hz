import type { TuiAttachment, TuiTransportAttachment } from '../types/invocation.js';
import type { GlobalThreadGoal } from '@hz/shared/global-events';
import type {
  TuiAgent,
  TuiAgentDetail,
  TuiAgentDraft,
  TuiCompactionResult,
  TuiConfiguredMcpConfig,
  TuiConfiguredMcpServer,
  TuiConfiguredMcpServerDetail,
  TuiMcpServer,
  TuiMcpTestResult,
  TuiModel,
  TuiPendingPermission,
  TuiQuestionnaireReplyAnswer,
  TuiQuestionnaireRequest,
  TuiQueuedMessage,
  TuiQueueReceipt,
  TuiSessionUsage,
  TuiSessionUsageSummary,
  TuiSkillList,
} from '../types/runtime-models.js';
import type { TuiRuntimeEvent } from '../types/runtime-events.js';
import type { TuiPermissionMode } from '../application/permission-mode.js';
import type { TuiMessage, TuiStreamEvent } from './stream-events.js';
import type { McodeProviderRuntimePort } from '../provider/contract.js';
import type { McodePluginRuntimeAccess } from '../plugin/contract.js';
import type { TuiDailyCheckinOutcome } from '../checkin/application.js';
import type {
  AbortSessionReq,
  CliSendMessageReq,
  CliSendMessageOptions,
  ConversationSteerInput,
  ConversationSteerResult,
} from '@hz/local-runtime-v2/cli-service';

export type { TuiMessage, TuiMessagePart, TuiStreamEvent, TuiToolCall } from './stream-events.js';
export type { TuiRuntimeEvent } from '../types/runtime-events.js';

/** TUI presentation choice for the two rewind modes exposed by DesktopService. */
export type TuiRewindScope = 'conversation' | 'conversation_and_files';

export interface TuiSessionInputSummary {
  userMessageId: string;
  assistantMessageId?: string;
  contentHead?: string;
  timestamp: number;
  fileChangeCount: number;
}

export interface TuiRewindPreviewFile {
  readonly filePath: string;
  readonly action: string;
  readonly skipped: boolean;
}

export interface TuiRewindPreviewTurn {
  readonly turnId: string;
  readonly files: readonly TuiRewindPreviewFile[];
}

export interface TuiRewindPreview {
  readonly turns: readonly TuiRewindPreviewTurn[];
}

export interface TuiRewindTurnDiffOutcome {
  status: string;
  revertedTurnIds?: readonly string[];
  errorCode?: string;
}

export interface TuiRewindResult {
  rewound: boolean;
  displayRevision?: string;
  historyRevision?: string;
  deletedMessageIds?: readonly string[];
  turnDiffRewind?: TuiRewindTurnDiffOutcome;
}

export interface TuiRewindInput {
  sessionId: string;
  userMessageId: string;
  clientRequestId: string;
  rewindTurnDiff?: boolean;
}

export interface TuiEditMessageAttachment {
  type: 'file' | 'image';
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  filePath?: string;
  assetId?: string;
}

export interface TuiEditMessageInput extends TuiRewindInput {
  content: string;
  attachments?: readonly TuiEditMessageAttachment[];
}

export interface TuiEditMessageResult extends TuiRewindResult {
  turnId?: string;
  userMessageId?: string;
}

export interface TuiSession {
  sessionId: string;
  agentName?: string;
  title?: string;
  parentSessionId?: string;
  sessionType?: 'root' | 'branch';
  sessionKind?: string;
  visibility?: 'visible' | 'hidden';
  purpose?: string;
  archived?: boolean;
  workspaceDir?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  status?: string;
  errorMessage?: string;
  errorCode?: number;
  errorSource?: string;
  errorDetail?: string;
  errorProviderId?: string;
  interactionMode?: 'plan';
  /**
   * Session-scoped model echo. `thinking.effort` is the authoritative
   * think-effort for this Session; the model roster only reports the
   * available options, never the chosen one.
   */
  model?: TuiSessionModelSelection;
}

export interface TuiSessionModelSelection {
  providerId?: string;
  modelId?: string;
  variant?: string;
  thinking?: TuiModelThinkingSelection;
}

export interface CreateTuiSessionInput {
  workspaceDir: string;
  title?: string;
  /**
   * The Agent this Session runs *as*.
   *
   * **The whole of what "start a chat with an agent" means**: the runtime records
   * it and every Turn is composed from that Agent's prompt, tools and model. Omit
   * it for the runtime's own default, which is what every other caller does.
   */
  agentName?: string;
  mcpServers?: readonly TuiSessionMcpServer[];
  /** Parent Session of a branch child. Required to create a BTW side session. */
  parentSessionId?: string;
  /** `hidden` keeps the Session out of every user-facing Session list. */
  visibility?: 'visible' | 'hidden';
  /**
   * Session purpose marker. Runtime derives `sessionKind: 'peek'` from a
   * `peek_` / `peek:` prefix on a branch child, and every Session-list index
   * predicate already excludes `peek`, so a peek purpose is what keeps a side
   * Session out of `/sessions` and `/resume` without a schema change.
   */
  purpose?: string;
}

export type TuiSessionMcpServer =
  | {
      readonly name: string;
      readonly type: 'stdio';
      readonly command: string;
      readonly args: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
    }
  | {
      readonly name: string;
      readonly type: 'http' | 'sse';
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
    };

export interface ListTuiSessionsOptions {
  limit?: number;
  cursor?: string;
  includeArchived?: boolean;
  onlyArchived?: boolean;
  includeHidden?: boolean;
  includePurposePrefix?: string;
  excludePurposePrefix?: string;
}

export interface ListTuiSessionPageInput extends ListTuiSessionsOptions {
  agentName?: string;
  allAgents?: boolean;
  workspaceDir?: string;
}

export interface TuiSessionPage {
  sessions: TuiSession[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface TuiMessagePageInput {
  limit?: number;
  before?: string;
}

export interface TuiMessagePage {
  messages: TuiMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface TuiSessionPort {
  createSession(input: CreateTuiSessionInput): Promise<TuiSession>;
  configureSessionMcpServers(
    sessionId: string,
    servers: readonly TuiSessionMcpServer[],
  ): Promise<void>;
  clearSessionMcpServers(sessionId: string): Promise<void>;
  listSessions(agentName?: string, options?: ListTuiSessionsOptions): Promise<TuiSession[]>;
  listSessionPage(input?: ListTuiSessionPageInput): Promise<TuiSessionPage>;
  /** @deprecated Use the object-shaped input overload. */
  listSessionPage(agentName?: string, options?: ListTuiSessionsOptions): Promise<TuiSessionPage>;
  getSession(sessionId: string): Promise<TuiSession>;
  getMessages(sessionId: string, limit?: number): Promise<TuiMessage[]>;
  listMessagePage(sessionId: string, input?: TuiMessagePageInput): Promise<TuiMessagePage>;
  renameSession(sessionId: string, title: string): Promise<TuiSession>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listSessionInputSummaries(
    sessionId: string,
    input?: { limit?: number; before?: string },
  ): Promise<readonly TuiSessionInputSummary[]>;
  getSessionRewindPreview(input: {
    sessionId: string;
    userMessageId: string;
  }): Promise<TuiRewindPreview>;
  rewindSession(input: TuiRewindInput): Promise<TuiRewindResult>;
  editSessionMessage(input: TuiEditMessageInput): Promise<TuiEditMessageResult>;
}

export interface TuiSessionForkOptions {
  canFork: boolean;
  unavailableReason?: string;
  suggestedTitle?: string;
  nextForkOrdinal?: number;
  sourceTitle?: string;
  worktreeVisible: boolean;
  worktreeEligible: boolean;
  worktreeUnavailableReason?: string;
}

export interface ForkTuiSessionInput {
  sessionId: string;
  assistantMessageId?: string;
  clientRequestId: string;
  title?: string;
  useSuggestedTitle: boolean;
  createIsolatedWorktree: boolean;
}

export interface TuiSessionForkResult {
  session: TuiSession;
  forkOriginMessageId?: string;
  sourceDisplayMessageId?: string;
  displayRevision?: string;
  historyRevision?: string;
}

export interface TuiSessionForkPort {
  getSessionForkOptions(
    sessionId: string,
    assistantMessageId?: string,
  ): Promise<TuiSessionForkOptions>;
  forkSession(input: ForkTuiSessionInput): Promise<TuiSessionForkResult>;
}

export interface TuiConfigurationPort extends McodeProviderRuntimePort {
  getRuntimeDiagnostics(): Promise<TuiRuntimeDiagnostics>;
  getInstructionSources(workspaceDir: string): Promise<readonly TuiInstructionSource[]>;
  getAccountStatus(
    sessionId?: string,
    options?: TuiAccountStatusOptions,
  ): Promise<TuiAccountStatus>;
  getPermissionMode(): Promise<TuiPermissionMode | undefined>;
  setPermissionMode(mode: TuiPermissionMode): Promise<TuiPermissionMode>;
  listModels(sessionId?: string): Promise<TuiModel[]>;
  selectModel(model: TuiModelSelection, sessionId?: string): Promise<boolean>;
  selectSessionModel(model: TuiModelSelection, sessionId: string): Promise<boolean>;
}

export interface TuiAccountStatusOptions {
  /** Inspect the model selected for this invocation without changing saved configuration. */
  readonly model?: TuiModelSelection;
  /** Validate the MiniMax account even when the selected model uses an API key. */
  readonly requireManagedAuth?: boolean;
  includeMembership?: boolean;
  /** Bypass completed account/membership caches while still coalescing in-flight work. */
  forceRefresh?: boolean;
}

export interface TuiInspectionPort {
  getSessionUsage(sessionId: string): Promise<TuiSessionUsage>;
  getSessionUsageSummary?(sessionId: string): Promise<TuiSessionUsageSummary>;
  watchSessionUsageCommits?(signal: AbortSignal): AsyncGenerator<string>;
  requestCompaction(
    sessionId: string,
    agentName?: string,
    customInstructions?: string,
  ): Promise<TuiCompactionResult>;
  listSkills(agentName?: string, keyword?: string): Promise<TuiSkillList>;
  /// The whole roster, Skills that are switched off included.
  ///
  /// **`listSkills` cannot answer this one.** It is the *runtime* list — what the
  /// model is told about — and a Skill switched off is filtered out of it, so a
  /// screen built on it could never draw the row that turns one back on.
  listAllSkills(agentName?: string): Promise<TuiSkillList>;
  /// One Skill's own text, or `undefined` for one the registry cannot find.
  readSkill(skillName: string, locationUri?: string): Promise<string | undefined>;
  /// Switches one Skill on or off, and answers whether it ended up as asked.
  ///
  /// **The `locationUri` is not decoration.** The registry keys its disabled set
  /// by it, and the reader picks a row by *name* — so the row has to hand back
  /// what it was built from, or a rename between the read and the press leaves
  /// the switch setting a Skill that no longer answers to that name.
  setSkillEnabled(
    skillName: string,
    enabled: boolean,
    locationUri?: string,
  ): Promise<boolean>;
  /// Every Agent definition this machine holds, the built-in roles included.
  ///
  /// **Definitions, not Sessions** — an Agent is what a Session is started
  /// *under*, and this says nothing about what is running.
  listAgents(input?: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<readonly TuiAgent[]>;
  /// One Agent with its stored prompt, or `undefined` for one that is gone.
  ///
  /// `undefined` is an answer rather than a throw, for the reason
  /// [`readSkill`](Self::readSkill) gives: the row may have been deleted between
  /// the list and the press.
  getAgent(name: string): Promise<TuiAgentDetail | undefined>;
  /// Writes a new Agent definition down, and answers what was stored.
  ///
  /// **Definition-only**: no Root Session and no greeting. A Session is started
  /// later, explicitly, by whoever wants to talk to it.
  createAgent(input: TuiAgentDraft): Promise<TuiAgentDetail>;
  /// Rewrites an Agent's identity and prompt. Absent fields are left as stored.
  updateAgent(name: string, input: TuiAgentDraft): Promise<TuiAgentDetail>;
  /// Removes an Agent definition, answering whether one was there.
  deleteAgent(name: string): Promise<boolean>;
  listMcpServers(keyword?: string, sessionId?: string): Promise<TuiMcpServer[]>;
  /// The reader's own MCP store — every server written down, off ones included.
  ///
  /// **`listMcpServers` above cannot answer this.** That one is what a *session*
  /// can reach, and a server switched off is not in it at all — so a screen built
  /// on it could switch one off and then never see it again to switch it back on.
  /// This is the file on this machine, with no live status attached: whether a
  /// server is up is [`testConfiguredMcpServer`]'s question.
  listConfiguredMcpServers(keyword?: string): Promise<TuiConfiguredMcpServer[]>;
  /// One server's whole configuration.
  ///
  /// The only read that carries `env` and `headers` — which is why it is asked for
  /// one server at a time rather than riding the listing.
  getConfiguredMcpServer(name: string): Promise<TuiConfiguredMcpServerDetail | undefined>;
  createConfiguredMcpServer(
    name: string,
    config: TuiConfiguredMcpConfig,
  ): Promise<TuiConfiguredMcpServerDetail>;
  updateConfiguredMcpServer(
    name: string,
    config: TuiConfiguredMcpConfig,
  ): Promise<TuiConfiguredMcpServerDetail>;
  deleteConfiguredMcpServer(name: string): Promise<boolean>;
  setConfiguredMcpServerEnabled(
    name: string,
    enabled: boolean,
  ): Promise<TuiConfiguredMcpServer>;
  /// Connects once and answers what happened.
  ///
  /// Kept apart from saving because the two fail differently: an entry can be
  /// written down cleanly and still name a command that is not installed.
  testConfiguredMcpServer(name: string): Promise<TuiMcpTestResult>;
  inspectProjectMcp(sessionId: string): Promise<TuiProjectMcpPreview | undefined>;
  getContextSnapshot(sessionId: string): Promise<TuiContextSnapshotResponse>;
}

export type TuiContextComponentKind =
  | 'SYSTEM_PROMPT'
  | 'MEMORY'
  | 'TOOLS'
  | 'SKILLS'
  | 'MESSAGES'
  | 'OTHER';

export interface TuiContextUsageSnapshot {
  readonly contextWindowTokens: number;
  readonly usedTokens: number;
  readonly totalCountSource: 'LOCAL_ESTIMATE' | 'PROVIDER_USAGE_ANCHORED';
  readonly components: ReadonlyArray<{
    readonly kind: TuiContextComponentKind;
    readonly tokens: number;
  }>;
}

export interface TuiContextSnapshotResponse {
  readonly status: 'loading' | 'empty' | 'live' | 'stale';
  readonly model?: {
    readonly provider: string;
    readonly id: string;
    readonly contextWindow?: number;
  };
  readonly contextUsage?: TuiContextUsageSnapshot;
  readonly compaction?: {
    readonly state: 'never' | 'running' | 'completed' | 'failed';
    readonly lastCompactedAtMs?: number;
  };
}

export interface TuiFeedbackPort {
  prepareFeedback(input: { description: string; sessionId?: string }): Promise<TuiFeedbackPreview>;
  submitFeedback(draftId: string, options?: TuiFeedbackSubmitOptions): Promise<TuiFeedbackReceipt>;
  cancelFeedback(draftId: string): Promise<boolean>;
}

export interface TuiDailyCheckin {
  runDailyCheckin(): Promise<TuiDailyCheckinOutcome>;
}

export interface TuiQueueSnapshot {
  readonly items: readonly TuiQueuedMessage[];
  readonly paused: boolean;
  readonly pendingCount: number;
}

export interface TuiQueuePort {
  getQueueSnapshot(sessionId: string): Promise<TuiQueueSnapshot>;
  continueQueue(sessionId: string): Promise<void>;
  listQueuedMessages(sessionId: string): Promise<TuiQueuedMessage[]>;
  steerQueuedMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ queueItemId: string; turnId: string }>;
  enqueueMessage(
    sessionId: string,
    content: string,
    options?: EnqueueTuiMessageOptions,
  ): Promise<TuiQueueReceipt>;
  updateQueuedMessageContent(
    sessionId: string,
    itemId: string,
    content: string,
  ): Promise<TuiQueuedMessage | undefined>;
  deleteQueuedMessage(sessionId: string, itemId: string): Promise<TuiQueuedMessage | undefined>;
}

export interface TuiInteractionPort {
  getPendingQuestionnaire(
    agentName: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<TuiQuestionnaireRequest | undefined>;
  getLatestPlanReview(
    agentName: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<TuiQuestionnaireRequest | undefined>;
  getPlanModeCapabilities(): Promise<{ readonly entryEnabled: boolean }>;
  replyQuestionnaire(
    agentName: string,
    requestId: string,
    answers: TuiQuestionnaireReplyAnswer[],
  ): Promise<boolean>;
  dismissQuestionnaire(agentName: string, requestId: string): Promise<boolean>;
  listPendingPermissions(signal?: AbortSignal): Promise<TuiPendingPermission[]>;
  replyPermission(
    agentName: string,
    requestId: string,
    decision: TuiPermissionDecision,
  ): Promise<boolean>;
}

export interface TuiRuntimeEventPort {
  watchEvents(signal: AbortSignal): AsyncGenerator<TuiRuntimeEvent>;
}

export interface TuiGoalPort {
  isGoalEnabled(): boolean;
  getGoal(sessionId: string): Promise<GlobalThreadGoal | undefined>;
  createGoal(input: {
    readonly sessionId: string;
    readonly objective: string;
    readonly tokenBudget?: number | null;
    readonly attachments?: readonly TuiAttachment[];
  }): Promise<GlobalThreadGoal>;
  patchGoal(
    sessionId: string,
    patch: {
      readonly status?: GlobalThreadGoal['status'];
      readonly objective?: string;
      readonly tokenBudget?: number | null;
    },
  ): Promise<GlobalThreadGoal>;
  clearGoal(sessionId: string): Promise<boolean>;
}

export interface TuiSessionTurnPort {
  watchSessionTurn(
    sessionId: string,
    turnId: string,
    signal: AbortSignal,
    options?: WatchTuiSessionTurnOptions,
  ): AsyncGenerator<TuiStreamEvent>;
}

export interface TuiConversationPort {
  sendMessage(
    req: CliSendMessageReq,
    signal?: AbortSignal,
    options?: CliSendMessageOptions,
  ): AsyncGenerator<TuiStreamEvent>;
  abortSession(req: AbortSessionReq): Promise<boolean>;
  steer(input: ConversationSteerInput): Promise<ConversationSteerResult>;
}

export interface WatchTuiSessionTurnOptions {
  afterMsgId?: string;
  afterCursor?: string;
}

export interface TuiWorkspaceFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  ignored?: boolean;
}

export interface TuiWorkspaceRoot {
  path: string;
  label?: string;
  primary?: boolean;
}

export interface TuiWorkspaceFileCandidate {
  workspaceDir: string;
  path: string;
}

export interface TuiWorkspaceTreeCandidate extends TuiWorkspaceFileEntry {
  workspaceDir: string;
}

/**
 * A pull request / merge request the current branch is known to belong to.
 *
 * Recorded by the Runtime when an agent turn ran `gh pr create|view` or
 * `glab mr create|view`; never fetched from a git host, so it is present only
 * for branches whose review passed through this machine.
 */
export interface TuiReviewLink {
  vendor: 'github' | 'gitlab';
  url: string;
  number: number;
}

export interface TuiWorkspaceGitMetadata {
  isGitRepo: boolean;
  branch: string;
  detached: boolean;
  isWorktree: boolean;
  reviewLink?: TuiReviewLink;
}

export interface TuiWorkspaceGitPort {
  getWorkspaceGitMetadata(workspaceDir: string): Promise<TuiWorkspaceGitMetadata>;
}

export interface TuiWorkspaceFilePort {
  listWorkspaceFileTree(
    workspaceDir: string,
    path?: string,
    signal?: AbortSignal,
  ): Promise<TuiWorkspaceFileEntry[]>;
  searchWorkspaceFiles(
    workspaceDir: string,
    query: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<string[]>;
  listWorkspaceFileTreeCandidates?(
    request: {
      roots: readonly TuiWorkspaceRoot[];
      path?: string;
    },
    signal?: AbortSignal,
  ): Promise<TuiWorkspaceTreeCandidate[]>;
  searchWorkspaceFileCandidates?(
    request: {
      roots: readonly TuiWorkspaceRoot[];
      query: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<TuiWorkspaceFileCandidate[]>;
}

export type TuiDelegatedAgentStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'unknown';

export interface TuiDelegatedAgent {
  sessionId: string;
  parentSessionId: string;
  agentName?: string;
  task?: string;
  status: TuiDelegatedAgentStatus;
  backgroundTaskId?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  errorMessage?: string;
}

export interface TuiDelegationSnapshot {
  schemaVersion: 1;
  rootSessionId: string;
  members: TuiDelegatedAgent[];
}

export interface TuiDelegationStopReceipt {
  schemaVersion: 1;
  rootSessionId: string;
  rootStopped: boolean;
  stoppedSessionIds: string[];
  activeSessionIds: string[];
  failedSessionIds: string[];
}

export interface TuiDelegationPort {
  getDelegationSnapshot(rootSessionId: string): Promise<TuiDelegationSnapshot>;
  stopDelegation(rootSessionId: string): Promise<TuiDelegationStopReceipt>;
}

export type TuiBackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'lost';

export interface TuiBackgroundTask {
  readonly taskId: string;
  readonly kind: 'bash' | 'workflow' | 'custom';
  readonly status: TuiBackgroundTaskStatus;
  readonly ownerSessionId: string;
  readonly description?: string;
  /** Full Bash source, distinct from the Runtime's shortened list description. */
  readonly command?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
  readonly deliveredAtMs?: number;
  readonly lastError?: string;
}

export interface TuiBackgroundTaskCapability {
  listBackgroundTasks?(ownerSessionId: string): Promise<readonly TuiBackgroundTask[]>;
}

export interface TuiActiveRunSnapshot {
  schemaVersion: 1;
  sessionId: string;
  state: 'running' | 'decision-blocked' | 'terminal' | 'idle';
  turnId?: string;
  actions: {
    steer: boolean;
  };
  retryReason?: string;
}

export interface TuiActiveRunControlPort {
  getActiveRun(sessionId: string): Promise<TuiActiveRunSnapshot>;
}

/**
 * Product-facing Runtime surface required by the interactive MCode TUI.
 *
 * Headless run lifecycle is intentionally excluded: commands and application
 * services should depend on the narrow domain ports above instead of this
 * composed product boundary.
 */
export type TuiRuntime = TuiSessionPort &
  TuiConversationPort &
  TuiConfigurationPort &
  TuiInspectionPort &
  TuiFeedbackPort &
  TuiDailyCheckin &
  TuiQueuePort &
  TuiInteractionPort &
  TuiRuntimeEventPort &
  TuiGoalPort &
  TuiSessionTurnPort &
  TuiDelegationPort &
  TuiBackgroundTaskCapability &
  TuiActiveRunControlPort &
  TuiWorkspaceGitPort &
  McodePluginRuntimeAccess &
  Partial<TuiSessionForkPort> &
  Partial<TuiWorkspaceFilePort>;

export type TuiPermissionDecision = 'allowOnce' | 'allowAlways' | 'deny';
export interface TuiModelThinkingSelection {
  /** Explicit think-effort level; omitted means "let Runtime pick the default". */
  effort?: string;
}

export interface TuiModelSelection {
  contextLimit?: number;
  providerId: string;
  modelId: string;
  variant?: string;
  thinking?: TuiModelThinkingSelection;
}
export type {
  TuiAgent,
  TuiAgentDetail,
  TuiAgentDraft,
  TuiCompactionResult,
  TuiConfiguredMcpConfig,
  TuiConfiguredMcpServer,
  TuiConfiguredMcpServerDetail,
  TuiConfiguredMcpTransport,
  TuiMcpServer,
  TuiMcpTestResult,
  TuiModel,
  TuiPendingPermission,
  TuiQuestionnaireReplyAnswer,
  TuiQuestionnaireRequest,
  TuiQueuedMessage,
  TuiQueueReceipt,
  TuiSessionUsage,
  TuiSessionUsageRow,
  TuiSessionUsageSummary,
  TuiSkillList,
} from '../types/runtime-models.js';

export interface TuiFeedbackDiagnosticRow {
  label: string;
  value: string;
}

export interface TuiFeedbackPreview {
  schemaVersion: 1;
  draftId: string;
  description: string;
  diagnostics: TuiFeedbackDiagnosticRow[];
  diagnosticBundleIncluded: boolean;
  included: string[];
  excluded: string[];
  expiresAtMs: number;
}

export interface TuiFeedbackReceipt {
  schemaVersion: 1;
  ticketId?: string;
  uploadId?: string;
  status: 'processing' | 'resolved' | 'unknown';
  createdAtMs?: number;
}

export type TuiFeedbackPhase =
  | 'preparing'
  | 'uploading-diagnostics'
  | 'creating-ticket'
  | 'completed';

export interface TuiFeedbackSubmitOptions {
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: TuiFeedbackPhase) => void;
}

export interface EnqueueTuiMessageOptions {
  attachments?: readonly TuiTransportAttachment[];
  clientIntent?: TuiPlanClientIntent;
  model?: TuiModelSelection;
  reviewRequest?: { readonly scope: 'local_changes' };
}

export type TuiPlanClientIntent = 'plan-entry' | 'plan-exit';
export type TuiPausedQueueSendIntent = 'paused-queue-keep' | 'paused-queue-clear';
export type TuiClientIntent = TuiPlanClientIntent | 'retry-continuation' | TuiPausedQueueSendIntent;

export interface TuiAccountStatus {
  status: 'ready' | 'needs-login' | 'warning' | 'unknown';
  defaultModel?: string;
  providerId?: string;
  modelId?: string;
  authMode?: string;
  managedTokenPresent?: boolean;
  identity?: { readonly email?: string; readonly name?: string };
  modelSource?: 'token-plan' | 'byok';
  tokenPlanQuotaState?: 'available' | 'not-subscribed' | 'unavailable';
  tokenPlanSummary?: TuiTokenPlanSummary;
  tokenPlanQuota?: TuiTokenPlanQuota;
  warnings: string[];
}

export interface TuiInstructionSource {
  readonly scope: 'global' | 'project';
  readonly path: string;
}

export interface TuiTokenPlanQuotaWindow {
  remainingPercent?: number;
  resetAtMs?: number;
  unlimited: boolean;
}

export interface TuiTokenPlanQuota {
  fiveHour: TuiTokenPlanQuotaWindow;
  weekly: TuiTokenPlanQuotaWindow;
  video?: TuiTokenPlanVideoQuota;
}

export interface TuiTokenPlanSummary {
  tier?: string;
  expiresAtMs?: number;
  creditBalance?: string;
}

export interface TuiTokenPlanVideoQuota {
  remainingCount?: number;
  totalCount?: number;
  resetAtMs?: number;
  unlimited: boolean;
}

export interface TuiRuntimeDiagnostics {
  status?: string;
  surface?: string;
  runtimeMode?: string;
  runtimeOwnerKind?: string;
  runtimeOwnerId?: string;
  dataDir?: string;
  configPath?: string;
  configPresent?: boolean;
  authCachePresent?: boolean;
  defaultModel?: string;
  providerId?: string;
  modelId?: string;
  providerBaseUrl?: string;
  authMode?: string;
  authModeSource?: string;
  managedTokenPresent?: boolean;
  apiKeyPresent?: boolean;
  customProviderCount?: number;
  warnings: string[];
}

export interface TuiProjectMcpPreview {
  path: string;
  digest: string;
  error?: string;
  servers: Array<{
    name: string;
    transport: string;
    target: string;
    status: 'configured' | 'available' | 'disabled' | 'error';
    error?: string;
  }>;
}
