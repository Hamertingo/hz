export interface TuiAttachmentView {
  meta?: {
    attachmentType?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  };
  local?: { assetId?: string; filePath?: string; dataUrl?: string };
  cloud?: {
    uploadId?: string;
    driveNodeId?: string;
    url?: string;
    dataUrl?: string;
  };
  previewUrl?: string;
  status?: string;
}

export interface TuiQueuedMessage {
  itemId: string;
  sessionId: string;
  status: string;
  source?: string;
  reviewRequest?: { scope: 'local_changes' };
  content?: string;
  attachments?: TuiAttachmentView[];
  modelInfo?: {
    providerId?: string;
    modelId?: string;
    variant?: string;
    displayName?: string;
  };
  createdAt?: number;
  expiresAt?: number;
  startedAt?: number;
  finishedAt?: number;
  failedReason?: string;
}

export interface TuiQuestionnaireImage {
  src: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface TuiQuestionnaireOption {
  id: string;
  label: string;
  description?: string;
  image?: TuiQuestionnaireImage;
  recommended?: true;
}

export interface TuiQuestionnaireStep {
  id: string;
  header?: string;
  question: string;
  description?: string;
  image?: TuiQuestionnaireImage;
  selectionMode: 0 | 1 | 'single' | 'multiple';
  options?: TuiQuestionnaireOption[];
  allowOther: boolean;
  otherPlaceholder: string;
  required: boolean;
}

export interface TuiQuestionnaireRequest {
  schemaVersion: number;
  id: string;
  title?: string;
  tool?: { messageId: string; callId: string };
  requester?: {
    sessionId: string;
    runId?: string;
    toolCallId?: string;
    agentName?: string;
  };
  presentation: {
    replaceComposer: boolean;
    showProgress: boolean;
    allowBackNavigation: boolean;
  };
  steps: TuiQuestionnaireStep[];
  expiresAt?: number;
  status?: number | string;
  createdAt?: number;
  purpose?: 'general' | 'goal';
  mode?: string;
  modePayload?: {
    featureKey?: string;
    planReview?: {
      markdown: string;
      path: string;
    };
  };
}

export interface TuiQuestionnaireReplyAnswer {
  stepId: string;
  selectedOptionIds?: string[];
  selectedOther?: boolean;
  otherText?: string;
  skipped?: boolean;
}

export type TuiStructuredPreviewState = 'proposed' | 'applied' | 'not-applied';

export interface TuiDiffPreviewBlock {
  kind: 'diff';
  path?: string;
  diff: string;
  addedLines: number;
  removedLines: number;
  truncated: boolean;
  omittedLines?: number;
}

export interface TuiFilePreviewBlock {
  kind: 'file';
  path?: string;
  content: string;
  lineCount: number;
  truncated: boolean;
  omittedLines?: number;
}

export interface TuiPreviewSummaryBlock {
  kind: 'summary';
  path?: string;
  message: string;
  reason: 'binary' | 'too-large' | 'unavailable';
  byteCount?: number;
}

export type TuiStructuredPreviewBlock =
  | TuiDiffPreviewBlock
  | TuiFilePreviewBlock
  | TuiPreviewSummaryBlock;

export interface TuiStructuredPreview {
  schemaVersion: 1;
  state: TuiStructuredPreviewState;
  blocks: TuiStructuredPreviewBlock[];
}

export interface TuiPendingPermission {
  requestId?: string;
  toolName?: string;
  ruleContents?: string[];
  toolInput?: string;
  toolDescription?: string;
  reason?: string;
  sessionId?: string;
  agentName?: string;
  allowAlwaysSupported?: boolean;
  createdAt?: number;
  structuredPreview?: TuiStructuredPreview;
}

export interface TuiModel {
  providerId: string;
  modelId: string;
  displayName?: string;
  selected?: boolean;
  variant?: string;
  supportedVariants?: string[];
  contextLimit?: number;
  contextWindowOptions?: number[];
  contextWindowOptionHints?: Record<string, 'higher_usage'>;
  maxOutputTokens?: number;
  thinkingConfig?: {
    mode?: string;
    defaultValue?: string;
  };
  /** Ordered think-effort levels the model accepts; empty when unsupported. */
  effortOptions?: string[];
  /** Catalog default, including a fixed effort without editable options. */
  defaultEffort?: string;
  /** Runtime projects the saved global or Session selection onto the selected row. */
  thinking?: { effort?: string };
  providerName?: string;
  providerSource?: string;
  providerKind?: string;
  apiFormat?: string;
  status?: {
    state?: string;
    lastTestedAt?: number;
    lastErrorCode?: string;
    lastErrorMessage?: string;
  };
}

export interface TuiSessionUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  turns?: number;
}

export interface TuiSessionUsageRow {
  id?: number;
  sessionId?: string;
  agentName?: string;
  frameworkType?: string;
  turnId?: string;
  model?: string;
  ts?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  rawJson?: string;
}

export interface TuiSessionUsage {
  summary?: TuiSessionUsageSummary;
  rows?: TuiSessionUsageRow[];
}

export interface TuiCompactionResult {
  success: boolean;
  sessionId?: string;
  compactionId?: string;
  messagesBefore?: number;
  messagesAfter?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  error?: string;
  code?: string;
}

export interface TuiSkill {
  name: string;
  displayName?: string;
  description?: string;
  displayDescription?: string;
  scope?: number;
  sourceType?: number;
  agentName?: string;
  url?: string;
  id?: number;
  createdAt?: number;
  updatedAt?: number;
  locationUri?: string;
  displayNames?: Record<string, string>;
  descriptions?: Record<string, string>;
  sourceKind?: string;
  enabled?: boolean;
}

export interface TuiSkillList {
  skills?: TuiSkill[];
  hasMore?: boolean;
}

/// One Agent definition, as a client is told about it.
///
/// **A definition, not a Session.** The built-in roles and every custom Agent
/// are the same kind of row here; what files them apart is `creationSource`,
/// carried verbatim from the store so a source added later draws as itself.
export interface TuiAgent {
  name: string;
  displayName: string;
  description?: string;
  /// A marker (`mavis-agent-avatar://default/v1/N`) or a data URL, as stored.
  avatar?: string;
  agentRole: string;
  creationSource: string;
}

/// One Agent with its stored prompt — the read a form opens on.
///
/// **The prompt rides this read and never the listing.** A listing that carried
/// every prompt would be whole documents for a screen drawing names, so `get` is
/// the one call that asks for content.
export interface TuiAgentDetail {
  agent: TuiAgent;
  systemPrompt?: string;
  persona?: string;
}

/// What a client writes down.
///
/// One shape for a create and a rewrite: an absent field means "leave it", which
/// is what a rewrite wants (a screen that only changed the prompt must not blank
/// the description).
export interface TuiAgentDraft {
  name?: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  systemPrompt?: string;
  persona?: string;
  /// The definition to write whole, rather than built from the identity fields.
  initialDefinition?: TuiAgentInitialDefinition;
}

/// The canonical definition, as a client may state it.
///
/// **A model belongs here and nowhere else.** An Agent with none of its own falls
/// back to the runtime default, and the store refuses to save an Agent whose model
/// it cannot resolve — so on a machine whose default carries a context window the
/// catalog has no physical limit for, a model-less Agent can be created and never
/// edited again. Stating one at the write is what keeps the Agent runnable.
export interface TuiAgentInitialDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  effort?: string;
}

export interface TuiMcpServer {
  name: string;
  enabled: boolean;
  transport?: string;
  description?: string;
  sourceKind?: 'builtin' | 'configured';
  sourceScope?: 'project' | 'session';
  managed?: boolean;
  status?: 'available' | 'configured' | 'disabled' | 'error' | 'unavailable';
  available?: boolean;
  error?: string;
  tools?: Array<{ name: string; description?: string }>;
  configJson?: string;
}

/// One MCP server this machine has written down, as a row.
///
/// **The reader's own store, not what a session can reach.** [`TuiMcpServer`]
/// above is the other list — built-ins, the project's own file, the session's set
/// — and a server switched off does not appear in it at all. This one carries
/// every server in the file, on or off, and says nothing about whether it is *up*:
/// that is a question only a connection test answers.
///
/// **No configuration rides here.** `env` and `headers` hold credentials, and a
/// listing drawn to show names has no business carrying them — see
/// [`TuiConfiguredMcpServerDetail`] for the one read that does.
export interface TuiConfiguredMcpServer {
  name: string;
  enabled: boolean;
  transport: TuiConfiguredMcpTransport;
  description?: string;
  /// The command for a stdio server, or the URL for a remote one — and never the
  /// arguments, the environment or the headers.
  endpoint?: string;
}

export type TuiConfiguredMcpTransport = 'stdio' | 'http' | 'streamable-http' | 'sse';

/// How a server talks, as the form that edits one spells it.
///
/// **Flat rather than a union over the transport.** A form switches transport and
/// the fields follow it, so the shape it holds is one object with the fields of
/// both; the runtime narrows it to the agent's own union at the boundary, which is
/// where "a stdio server has no `url`" can be said once and enforced.
export interface TuiConfiguredMcpConfig {
  transport: TuiConfiguredMcpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  description?: string;
}

/// One server's whole configuration — the one read that carries what the listing
/// leaves out.
export interface TuiConfiguredMcpServerDetail {
  name: string;
  enabled: boolean;
  config: TuiConfiguredMcpConfig;
}

/// What a connection test answered.
///
/// **`success: false` with a code rather than a throw.** A server that saves
/// cleanly and cannot be reached is the ordinary failure here, and the code is
/// what tells "the command is not installed" from "the handshake failed" — two
/// different things for the reader to go and do.
export interface TuiMcpTestResult {
  success: boolean;
  toolCount?: number;
  /// What the server offers, which the test already had in hand — it connects to
  /// count them, so handing them back saves a caller a second connection to answer
  /// the obvious next question.
  tools?: Array<{ name: string; description?: string }>;
  errorCode?: string;
  errorMessage?: string;
}

export interface TuiQueueReceipt {
  itemId?: string;
  status?: string;
  position?: number;
}
