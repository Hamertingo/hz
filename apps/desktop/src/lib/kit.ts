import { invoke } from "@tauri-apps/api/core";

import type { CommandReview } from "@/lib/roster";

/// The webview's side of `src-tauri/src/kit_cmds.rs`. One typed wrapper per command, so a screen never
/// spells a command name. A command the backend has not got yet rejects; callers treat that as "not ready"
/// and show the screen's empty state rather than an error. Marked `planned` below until `kit_cmds.rs` has it.

export type Verdict = { verdict: "allow" } | { verdict: "ask" | "refuse"; reason: string };
export type Draft = { id: string; to: string; subject: string; body: string; attachments: string[]; channel: string; state: { state: string; reason?: string }; receipt?: string | null };
export type VmState = "absent" | "stopped" | "starting" | "running" | "stopping";
export type VmSize = "small" | "medium" | "large";
/// How a run spent its time, from `agentkit/timings.rs`.
export type RunReport = { turn_ms: number; wake_ms: number; screen_ms: number; first_output_ms: number | null; tool_ms: number; model_ms: number; tools: Record<string, number> };
export type RunTiming = { session: string; seq: number; at: number; agent: string | null; model: string | null; input: number; output: number; report: RunReport };
export type DigestLine = { sessionId: string; line: string; seq: number };
export type RoutineOffer = { task: string; weekday: number | null; minuteOfDay: number; prompt: string; line: string; atMs: number };
export type BrainMode = "light" | "strong" | "rotate";
export type BrainState = { mode: BrainMode | null; turboUntil: number | null; lastHeavyAt: number | null; strong: boolean };
export type OnboardingEffect = { kind: "job" | "label" | "name"; value: string };
export type OnboardingStep = { agentText: string; choices: string[]; effects: OnboardingEffect[]; state: unknown; done: boolean; task: string | null };

export const kit = {
  review: (cmd: string, mode: string, workspace: string) => invoke<Verdict>("kit_review", { cmd, mode, workspace }),
  speech: (text: string) => invoke<string>("kit_speech", { text }),
  cost: (model: string, input: number, output: number) => invoke<number | null>("kit_cost", { model, input, output }),
  drafts: () => invoke<Draft[]>("kit_drafts_list"),
  draftNew: (d: { to: string; subject: string; body: string; attachments: string[]; channel: string }) => invoke<Draft>("kit_draft_new", d),
  draftAct: (id: string, action: "edit" | "send" | "discard", body?: string) => invoke<Draft>("kit_draft_act", { id, action, body }),
  pageHistory: (id: string) => invoke<[number, number][]>("kit_page_history", { id }),
  pageUpdate: (id: string, title: string, html: string, baseVersion: number) => invoke<{ ok: boolean; version?: number; changed?: string[]; current_version?: number }>("kit_page_update", { id, title, html, baseVersion }),
  pageRestore: (id: string, version: number) => invoke<number>("kit_page_restore", { id, version }),
  watchAdd: (bot: string, pid: number, label: string, log?: string) => invoke<void>("kit_watch_add", { bot, pid, label, log }),
  watchPoll: () => invoke<{ bot: string; message: string }[]>("kit_watch_poll"),
  payments: () => invoke<{ limits: { enabled: boolean; per_purchase_cents: number; per_month_cents: number; agents: string[] } }>("kit_payments_get"),
  e2eStatus: () => invoke<boolean>("kit_e2e_status"),
  e2eCreate: () => invoke<string>("kit_e2e_create"),
  takeover: (screen: number, on: boolean) => invoke<void>("kit_takeover", { screen, on }),
  takeoverState: (screen: number) => invoke<boolean>("kit_takeover_state", { screen }),

  // all wired in kit_cmds.rs; the Lima, voice, npm and PDF paths are unverified against the real tools
  vmState: (agent: string) => invoke<VmState>("kit_vm_state", { agent }),
  vmStart: (agent: string) => invoke<void>("kit_vm_start", { agent }),
  vmEnsure: (agent: string) => invoke<void>("kit_vm_ensure", { agent }),
  vmStop: (agent: string) => invoke<void>("kit_vm_stop", { agent }),
  vmSize: (agent: string, size: VmSize) => invoke<void>("kit_vm_size", { agent, size }),
  screenFor: (agent: string) => invoke<number>("kit_screen_for", { agent }),
  screenshot: (agent: string) => invoke<string>("kit_screenshot", { agent }),
  screenUrl: (agent: string) => invoke<string>("kit_screen_url", { agent }),
  callStart: (agent: string) => invoke<void>("kit_call_start", { agent }),
  callEnd: (agent: string) => invoke<string[]>("kit_call_end", { agent }),
  logins: (agent: string) => invoke<{ site: string; user: string; used: string }[]>("kit_logins", { agent }),
  loginRemove: (agent: string, site: string) => invoke<void>("kit_login_remove", { agent, site }),
  versions: (agent: string) => invoke<{ n: string; title: string; by: string; at: number }[]>("kit_versions", { agent }),
  versionRestore: (agent: string, n: string) => invoke<unknown>("kit_version_restore", { agent, n }),
  versionRecord: (agent: string, title: string, by: string, snapshotJson: string) => invoke<string>("kit_version_record", { agent, title, by, snapshotJson }),
  loginRecord: (agent: string, site: string, user: string) => invoke<void>("kit_login_record", { agent, site, user }),
  callSay: (agent: string, delta: string, last: boolean) => invoke<void>("kit_call_say", { agent, delta, last }),
  callHeard: (agent: string, text: string) => invoke<boolean>("kit_call_heard", { agent, text }),
  accountAdd: (id: string, engine: string, label: string) => invoke<{ id: string; engine: string; label: string }>("kit_account_add", { id, engine, label }),
  accountRemove: (id: string) => invoke<boolean>("kit_account_remove", { id }),
  accountAssign: (agent: string, accountId: string) => invoke<void>("kit_account_assign", { agent, accountId }),
  accountUnassign: (agent: string) => invoke<void>("kit_account_unassign", { agent }),
  accountOf: (agent: string) => invoke<{ id: string; engine: string; label: string } | null>("kit_account_of", { agent }),
  engineUpdates: () => invoke<{ engine: string; installed: string; latest: string }[]>("kit_engine_updates"),
  accounts: () => invoke<{ id: string; engine: string; label: string }[]>("kit_accounts"),
  appKeys: () => invoke<{ id: string; label: string; created: number; last_used: number | null }[]>("kit_app_keys"),
  appKeyCreate: (label: string) => invoke<{ id: string; key: string }>("kit_app_key_create", { label }),
  appKeyRevoke: (id: string) => invoke<void>("kit_app_key_revoke", { id }),
  paymentsSet: (limits: { enabled: boolean; per_purchase_cents: number; per_month_cents: number; agents: string[] }) => invoke<void>("kit_payments_set", { limits }),
  pdf: (title: string, agent: string, html: string) => invoke<string>("kit_pdf", { title, agent, html }),

  // kit_work.rs: how agents work and what they cost
  digests: (sessionIds: string[]) => invoke<DigestLine[]>("kit_digests", { sessionIds }),
  routineOffer: (agentId: string) => invoke<RoutineOffer | null>("kit_routine_offer", { agentId }),
  routineAnswer: (agentId: string, answer: "yes" | "time" | "no" | "dismiss", time?: string) => invoke<unknown>("kit_routine_answer", { agentId, answer, time }),
  brain: (agentId: string) => invoke<BrainState>("kit_brain_get", { agentId }),
  brainSet: (agentId: string, mode: BrainMode | null, turbo?: boolean) => invoke<BrainState>("kit_brain_set", { agentId, mode, turbo }),
  onboardingStart: () => invoke<OnboardingStep>("kit_onboarding_start"),
  onboardingNext: (state: unknown, input: string) => invoke<OnboardingStep>("kit_onboarding_next", { state, input }),
  timings: (sessionId?: string, limit?: number) => invoke<RunTiming[]>("kit_timings", { sessionId, limit }),

  // What agents post with their hz tools (agent_tools.rs).
  draftSend: (id: string, body?: string) => invoke<Draft>("kit_draft_send", { id, body }),
  pageGet: (id: string, version?: number) => invoke<{ id: string; title: string; version: number; current: number; html: string }>("kit_page_get", { id, version }),
  widgetGet: (id: string) => invoke<string>("kit_widget_get", { id }),
  loginAnswer: (agent: string, done: boolean) => invoke<void>("kit_login_answer", { agent, done }),
  agentCreated: (requestId: string, agentId: string | null, error?: string) => invoke<void>("kit_agent_created", { requestId, agentId, error }),
  /// A card a tool kept: the same shape `lib/hzTools.ts` builds from the call, as the backend stored it.
  post: (id: string) => invoke<Record<string, unknown>>("kit_post_get", { id }),
  loginPending: (agent: string) => invoke<Record<string, unknown> | null>("kit_login_pending", { agent }),

  // accounts and integrations (integrations.rs, google_account.rs, composio_link.rs, bark_push.rs, op_login.rs)
  integrations: () => invoke<Integrations>("integrations_status"),
  googleSetClient: (clientId: string, clientSecret: string) => invoke<void>("google_set_client", { clientId, clientSecret }),
  googleSignIn: (services: GoogleService[]) => invoke<{ email: string | null; services: GoogleService[] }>("google_sign_in", { services }),
  googleCancel: () => invoke<void>("google_cancel"),
  googleSignOut: () => invoke<void>("google_sign_out"),
  googleGrant: (agent: string, on: boolean) => invoke<void>("google_grant", { agent, on }),
  composioConnect: (workspaceId: string, key: string) => invoke<void>("composio_connect", { workspaceId, key }),
  composioDisconnect: () => invoke<void>("composio_disconnect"),
  barkSet: (key: string, encryptKey: string | null, fullText: boolean) => invoke<void>("bark_set", { key, encryptKey, fullText }),
  barkClear: () => invoke<void>("bark_clear"),
  barkFullText: (on: boolean) => invoke<void>("bark_full_text", { on }),
  barkTest: () => invoke<void>("bark_test"),
  opSet: (enabled: boolean, agents: string[]) => invoke<void>("op_set", { enabled, agents }),
  opLookup: (agent: string, site: string) => invoke<{ available: boolean; title?: string; reason?: string }>("op_lookup", { agent, site }),

  // safety: command_review.rs, safety_tools.rs, inbox.rs
  reviewDefault: () => invoke<CommandReview>("kit_review_default_get"),
  reviewDefaultSet: (mode: CommandReview) => invoke<void>("kit_review_default_set", { mode }),
  keyRequests: () => invoke<KeyAsk[]>("kit_key_requests"),
  keySave: (id: string, value: string) => invoke<void>("kit_key_save", { id, value }),
  keyDismiss: (id: string) => invoke<void>("kit_key_dismiss", { id }),
  keys: (agent: string) => invoke<string[]>("kit_keys", { agent }),
  keyRemove: (agent: string, name: string) => invoke<void>("kit_key_remove", { agent, name }),
  alwaysAllow: (sessionId: string, requestId: string) => invoke<string>("permission_always_allow", { sessionId, requestId }),
};

/// A key an agent is waiting on (`request_key`); the card takes the value straight to the keychain.
export type KeyAsk = { id: string; agentId: string; name: string; why: string };

export type GoogleService = "gmail" | "calendar" | "drive" | "organize";
export type Integrations = {
  google: { connected: boolean; hasClient: boolean; email: string | null; services: GoogleService[]; agents: string[] };
  composio: { connected: boolean; workspaces: string[] };
  bark: { connected: boolean; server: string; fullText: boolean; encrypted: boolean };
  onepassword: { installed: boolean; enabled: boolean; agents: string[] };
};
