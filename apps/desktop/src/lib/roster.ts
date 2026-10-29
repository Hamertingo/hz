import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { MASCOT_COLORS, MASCOT_KINDS, type MascotKind } from "@/lib/mascots";
import { readFolders, readRules, readTalk, type AskRule, type Folder, type Talk } from "@/lib/agentAccess";
import type { ApprovalPolicy, Harness } from "@/types/events";

/// The CLIs an agent can be put on, in the order they are offered. mcode is not
/// here: it is being removed, and an agent can no longer be created on it.
export const AGENT_HARNESSES: readonly Harness[] = ["claude-acp", "codex-acp", "opencode"];

const PERMISSIONS: readonly ApprovalPolicy[] = ["manual", "plan", "auto", "bypassPermissions"];

/// One Agent: a named, persistent conversation with a face.
///
/// **An Agent owns exactly one session**, bound the first time it is sent a
/// message. Until then `sessionId` is null and the sidebar draws it as a row that
/// opens an empty composer — the session does not exist before the first prompt,
/// so there is nothing to point at.
export type RosterAgent = {
  id: string;
  name: string;
  kind: MascotKind;
  color: string;
  /// The body, eyes, mouth, extra and pattern the reader picked. Absent on an agent from before faces had
  /// parts: its `kind` picks a body and a stable look is derived from its id (lib/face.ts).
  shape?: string;
  look?: { eyes?: string; mouth?: string; acc?: string; pat?: string };
  /// A photo (a data URL) drawn in place of the face.
  photo?: string | null;
  /// The CLI this agent runs on, which is the reader's own install of it.
  harness: Harness;
  /// The folder it works in, fixed at creation. Null only for an agent an older
  /// build made, which falls back to whatever folder is selected.
  projectPath: string | null;
  /// The model it starts on, or null for its CLI's own default. Changeable in
  /// the running chat; this is where the first turn begins.
  modelId: string | null;
  /// The effort level it starts on, or null for the model's own default.
  effort: string | null;
  /// What it may do without asking. Null takes whatever the composer holds, which
  /// is how an agent from before this field behaves. A new agent starts on `auto`:
  /// the widest stance that is not full access.
  permission: ApprovalPolicy | null;
  /// The workspace it belongs to. Null only until the first load of workspaces
  /// files an agent from before them into the default one.
  workspaceId: string | null;
  /// How it should behave, in the reader's words. Held with the agent so the
  /// backend entity can take it over whole; not sent to the CLI yet.
  instructions: string;
  /// One line on what it is for. Shown as a tooltip; the agent's real
  /// instructions will live in the backend entity this stands in for.
  role: string;
  /// Kept at the top of the sidebar's list, set from the chat's menu.
  pinned?: boolean;
  /// Its finished-turn and needs-you notices are held back, in the app and on the
  /// desktop. The chat itself still updates.
  muted?: boolean;
  /// Held: the turn in flight finishes, new messages wait. Sending is never blocked.
  paused?: boolean;
  /// Things it stops and asks about first. Advisory: they ride in its briefing
  /// as hard rules, and no tool call is intercepted.
  alwaysAsk?: AskRule[];
  /// Folders besides its own that it may touch.
  folders?: Folder[];
  /// Monthly spend limit in US dollars, or absent for none.
  budget?: number | null;
  /// Who may message it.
  talk?: Talk;
  /// hz's own tool servers switched off for it: `team`, `memory`.
  toolsOff?: string[];
  /// How its Mac commands are approved; absent follows Settings → Agents.
  commandReview?: CommandReview;
  sessionId: string | null;
};

/// What the command reviewer may approve on its own (`command_review.rs`).
export type CommandReview = "always_ask" | "auto_review" | "allow_all";
const REVIEWS: readonly CommandReview[] = ["always_ask", "auto_review", "allow_all"];

export type Roster = {
  agents: RosterAgent[];
  /// The Agent whose empty composer is on screen. The next session created is
  /// bound to it. Not persisted: a reload abandons the half-made start.
  pendingId: string | null;
};

/// Held in the webview's own store for now, as a stand-in: an Agent is a fact
/// about the reader, so it belongs in `~/.hz/settings.json` beside the spaces,
/// and moves there with the backend entity.
const KEY = "hz.roster";

/// The roster with `agent` added. A second agent with the same id is replaced,
/// which is what an edit is.
export function withAgent(roster: Roster, agent: RosterAgent): Roster {
  const rest = roster.agents.filter((a) => a.id !== agent.id);
  return { ...roster, agents: [...rest, agent] };
}

/// Binds the pending Agent to a session that has just been created.
///
/// Answers the same roster, untouched, when nothing is pending or the agent
/// already has a session: a second session is never silently adopted, since
/// that would move the agent's conversation out from under it.
export function withClaim(roster: Roster, sessionId: string): Roster {
  const pending = roster.agents.find((a) => a.id === roster.pendingId);
  if (!pending || pending.sessionId !== null) return { ...roster, pendingId: null };

  return {
    agents: roster.agents.map((a) => (a.id === pending.id ? { ...a, sessionId } : a)),
    pendingId: null,
  };
}

export function withoutAgent(roster: Roster, id: string): Roster {
  return {
    agents: roster.agents.filter((a) => a.id !== id),
    pendingId: roster.pendingId === id ? null : roster.pendingId,
  };
}

/// The parts of a face as stored, keeping only the strings; absent when none were picked, so the
/// derived look from the id still applies.
function readLook(raw: unknown): RosterAgent["look"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const pick = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  return { eyes: pick("eyes"), mouth: pick("mouth"), acc: pick("acc"), pat: pick("pat") };
}

/// Tolerant of whatever a previous build or a hand edit left: an entry that is
/// not an agent is dropped rather than failing the whole list.
export function readAgents(raw: unknown): RosterAgent[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.name !== "string") return [];

    return [
      {
        id: e.id,
        name: e.name,
        kind: MASCOT_KINDS.includes(e.kind as MascotKind) ? (e.kind as MascotKind) : "sun",
        color: typeof e.color === "string" ? e.color : MASCOT_COLORS[0],
        // An entry from before agents chose a CLI reads as Claude, the first one
        // offered, rather than being dropped: the agent and its session are real.
        shape: typeof e.shape === "string" ? e.shape : undefined,
        look: readLook(e.look),
        photo: typeof e.photo === "string" && e.photo ? e.photo : null,
        harness: AGENT_HARNESSES.includes(e.harness as Harness) ? (e.harness as Harness) : "claude-acp",
        role: typeof e.role === "string" ? e.role : "",
        projectPath: typeof e.projectPath === "string" ? e.projectPath : null,
        modelId: typeof e.modelId === "string" ? e.modelId : null,
        effort: typeof e.effort === "string" ? e.effort : null,
        workspaceId: typeof e.workspaceId === "string" && e.workspaceId ? e.workspaceId : null,
        permission: PERMISSIONS.includes(e.permission as ApprovalPolicy)
          ? (e.permission as ApprovalPolicy)
          : null,
        instructions: typeof e.instructions === "string" ? e.instructions : "",
        pinned: e.pinned === true,
        muted: e.muted === true,
        paused: e.paused === true,
        alwaysAsk: readRules(e.alwaysAsk),
        folders: readFolders(e.folders),
        budget: typeof e.budget === "number" && e.budget > 0 ? e.budget : null,
        talk: readTalk(e.talk),
        toolsOff: Array.isArray(e.toolsOff) ? e.toolsOff.filter((t): t is string => typeof t === "string") : [],
        commandReview: REVIEWS.includes(e.commandReview as CommandReview) ? (e.commandReview as CommandReview) : undefined,
        sessionId: typeof e.sessionId === "string" ? e.sessionId : null,
      },
    ];
  });
}

let fallbackWorkspace: string | null = null;

let state: Roster = { agents: readAgents(readLocalStorage<unknown>(KEY, [])), pendingId: null };
const listeners = new Set<() => void>();
// An empty webview store is not an empty roster: the backend keeps a copy on disk,
// and mirroring the empty list first would overwrite it before it could be read.
if (state.agents.length > 0) {
  mirror(state.agents);
} else {
  void invoke<unknown>("agents_load")
    .then((raw) => {
      const agents = readAgents(raw);
      if (agents.length > 0 && state.agents.length === 0) {
        commit({ ...state, agents: fallbackWorkspace ? adoptOrphans(agents, fallbackWorkspace) : agents });
      }
    })
    .catch(() => {});
}

function notify() {
  for (const listener of listeners) listener();
}

/// Mirrors the roster to the backend, which cannot ask the webview for it: a
/// teammate's message arrives while nobody is typing, and the briefing and the
/// team tools both need to know who the agents are. A failed call is dropped —
/// the next change sends the whole list again.
function mirror(agents: RosterAgent[]) {
  void invoke("agents_sync", { agents }).catch(() => {});
}

function commit(next: Roster) {
  state = next;
  writeLocalStorage(KEY, next.agents);
  mirror(next.agents);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoster(): Roster {
  return useSyncExternalStore(subscribe, () => state);
}

export function rosterAdd(agent: RosterAgent) {
  commit(withAgent(state, agent));
}

export function rosterRemove(id: string) {
  commit(withoutAgent(state, id));
}

/// Changes a few fields of one agent where it stands. `rosterAdd` would move it to the end of the list, which
/// is wrong for a pin, a mute or a move between workspaces: none of them is an edit of who the agent is.
export function rosterPatch(id: string, patch: Partial<RosterAgent>) {
  commit({ ...state, agents: state.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
}

/// Removes every agent of a deleted workspace.
export function rosterRemoveWorkspace(workspaceId: string) {
  commit(withoutWorkspace(state, workspaceId));
}

/// Tells the roster which workspace takes agents that have none, and files the
/// ones already here. Called once the workspaces are read.
export function rosterSetFallbackWorkspace(workspaceId: string) {
  fallbackWorkspace = workspaceId;
  const agents = adoptOrphans(state.agents, workspaceId);
  if (agents !== state.agents) commit({ ...state, agents });
}

/// Marks which Agent the next created session belongs to, or clears it.
export function rosterSetPending(id: string | null) {
  state = { ...state, pendingId: id };
  notify();
}

/// Whether the agent that owns `sessionId` has been muted. Read outside React,
/// from the notice path, which has no hook to ask with.
export function isSessionMuted(sessionId: string): boolean {
  return state.agents.some((a) => a.sessionId === sessionId && a.muted === true);
}

/// Agents with the pinned ones first, each group in its own order.
export function pinnedFirst<T extends { pinned?: boolean }>(agents: readonly T[]): T[] {
  return [...agents.filter((a) => a.pinned), ...agents.filter((a) => !a.pinned)];
}

/// Whether an agent is shown in a workspace. An agent with none belongs to
/// nobody: [`adoptOrphans`] files it as soon as the workspaces are known.
export function inWorkspace(agent: RosterAgent, workspaceId: string | null): boolean {
  return workspaceId !== null && agent.workspaceId === workspaceId;
}

/// Gives every agent without a workspace to `workspaceId`: the agents made
/// before workspaces existed. Returns the same array when there is none, so a
/// commit is skipped.
export function adoptOrphans(agents: RosterAgent[], workspaceId: string): RosterAgent[] {
  if (!agents.some((a) => a.workspaceId === null)) return agents;
  return agents.map((a) => (a.workspaceId === null ? { ...a, workspaceId } : a));
}

/// The roster without one workspace's agents. Their session files are not
/// touched: the conversations stay on disk.
export function withoutWorkspace(roster: Roster, workspaceId: string): Roster {
  const gone = new Set(roster.agents.filter((a) => a.workspaceId === workspaceId).map((a) => a.id));
  return {
    agents: roster.agents.filter((a) => !gone.has(a.id)),
    pendingId: roster.pendingId !== null && gone.has(roster.pendingId) ? null : roster.pendingId,
  };
}

/// Binds an agent to a conversation the backend started for it, because a
/// teammate wrote to it before the reader had. Leaves an agent that already has
/// one alone, for the reason [`withClaim`] does.
export function rosterBind(agentId: string, sessionId: string) {
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent || agent.sessionId !== null) return;
  commit({ ...state, agents: state.agents.map((a) => (a.id === agentId ? { ...a, sessionId } : a)) });
}

void listen<{ agentId: string; sessionId: string }>("agent_session_bound", (e) =>
  rosterBind(e.payload.agentId, e.payload.sessionId),
).catch(() => {});

/// Called where a session id is minted. A no-op unless an Agent was pending.
export function rosterClaim(sessionId: string) {
  if (state.pendingId === null) return;
  commit(withClaim(state, sessionId));
}

/// A new, unbound Agent. The id is minted here unless the caller has one (the
/// new-agent dialog derives it from the name), so the caller can mark it pending
/// in the same breath.
export function newAgent(
  fields: Omit<RosterAgent, "id" | "sessionId">,
  id: string = crypto.randomUUID(),
): RosterAgent {
  return { id, sessionId: null, ...fields };
}
