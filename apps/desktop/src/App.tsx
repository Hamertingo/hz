import { lazy, type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Eraser, Hash, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import "./App.css";
import Chat from "@/components/Chat";
import ChatInput from "@/components/ChatInput";
import DiffWorkerPool from "@/components/DiffWorkerPool";
import NoticeStack from "@/components/NoticeStack";
import LinkDialog from "@/components/chat/LinkDialog";
import QuitDialog from "@/components/QuitDialog";
import RenderErrorBoundary from "@/components/RenderErrorBoundary";
import type { SettingsTab } from "@/components/SettingsDialog";

// **Not lazy, unlike its neighbours below.** These are three small buttons the
// window needs the moment it draws — on Windows they are the only way to close
// it — and a chunk that has not arrived yet is a window with no controls. The
// lazy list is for surfaces that can afford a frame of nothing.
import { WindowControls } from "@/components/WindowControls";
import SlowRequestToast from "@/components/SlowRequestToast";
import WorktreeDialog, { type WorktreePrompt } from "@/components/WorktreeDialog";
import { prefetchPrList } from "@/hooks/usePrList";
import { reportViewing, useInbox } from "@/hooks/useInbox";
import { usePaletteSources } from "@/hooks/usePaletteSources";
import { DO_ICONS, jumpRows } from "@/components/jumpRows";
import { ChannelTile } from "@/components/sidebar/ConvRow";
import { setJumpTarget } from "@/lib/jumpTarget";
import { prKey, type PrRow } from "@/hooks/usePrList";
import { AgentChatContext } from "@/hooks/useAgentChat";
import { kit } from "@/lib/kit";
import { agentFromRequest, type AgentCreateRequest } from "@/lib/agentFactory";
import { useAgentGlances } from "@/hooks/useAgentGlances";
import { useTeamStatus } from "@/hooks/useTeamTalk";
import { teamActivity } from "@/lib/teamTalk";
import { INTRO_PROMPT } from "@/lib/intro";
import CallScreen from "@/components/call/CallScreen";
import EditAgentDialog from "@/components/profile/EditAgentDialog";
import ProfilePanel, { type ProfileTab } from "@/components/profile/ProfilePanel";
import AgentSidebar, { type SidebarPage } from "@/components/AgentSidebar";
import ChannelView from "@/components/ChannelView";
import NewChannelDialog from "@/components/NewChannelDialog";
import { archiveChannel, useChannels, useChannelsLoaded } from "@/hooks/useChannels";
import { displayNames } from "@/lib/agentLabel";
import { RESTORABLE_PAGES, resolveLanding, storedFor, withView, readLastView, type ViewTarget } from "@/lib/landing";
import { usePreference } from "@/lib/prefs";
import { saveOrder, useSavedOrder, useWorkspaces } from "@/hooks/useWorkspaces";
import { applyOrder, toFront } from "@/lib/order";
import AgentChatHeader from "@/components/chat/AgentChatHeader";
import ChatSheets from "@/components/chat/ChatSheets";
import ThreadView from "@/components/chat/ThreadView";
import ReplyBar from "@/components/composer/ReplyBar";
import { toast } from "@/components/ui/toast";
import { clearPage } from "@/lib/chatMarks";
import { askPrompt, handoffPrompt, hzSlashCommands, parseHz, splitTeammate } from "@/lib/composerCommands";
import { rememberInChat } from "@/lib/remember";
import { cancelReply, replyFor, startReply, useReplyDraft, type ReplyDraft } from "@/lib/replyDraft";
import { setRoutineDraft } from "@/lib/routineDraft";
import { timingsOf } from "@/lib/steps";
import NewAgentDialog, { type AgentDraft } from "@/components/NewAgentDialog";
import AttachButton from "@/components/composer/AttachButton";
import { inWorkspace, newAgent, pinnedFirst, rosterAdd, rosterRemove, rosterSetPending, useRoster, type RosterAgent } from "@/lib/roster";
import { usePrMarks } from "@/hooks/usePrMarks";
import { usePrReady } from "@/hooks/usePrReady";
import RightPanel, { PanelToggle, TabBody } from "@/components/RightPanel";
import { useChatColumnFloor } from "@/components/ResizeHandle";
import { SidebarToggle } from "@/components/SidebarToggle";
import { sessionUnits, sortSessions } from "@/lib/sessionOrder";
import { displayPath } from "@/lib/project";
import SplitView, { DragGhost, DropZone } from "@/components/SplitView";
import PendingAskPanel from "@/components/chat/PendingAskPanel";
import { DROP_ATTR, useSessionDrag } from "@/lib/dragSession";
import type { PaletteItem } from "@/lib/palette";
import { recalledPrompts } from "@/lib/recall";
import type { ShortcutId } from "@/lib/shortcuts";
import {
  closePane,
  dropLabel,
  EMPTY_VIEW,
  GROUPS_KEY,
  members,
  groupOf,
  pruneGroups,
  type SplitGroup,
} from "@/lib/groups";
import DictateControl from "@/components/composer/DictateControl";
import AppShell from "@/components/layout/AppShell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { pickAttachments } from "@/hooks/useAttachments";
import { useCodeTheme } from "@/hooks/useCodeTheme";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useGlass } from "@/hooks/useGlass";
import { useStudioAttributes } from "@/hooks/useStudioAttributes";
import { warmHighlighter } from "@/hooks/useHighlighter";
import { useHotkey } from "@/hooks/useHotkey";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { dismissNotice, getNotices, pushNotice } from "@/hooks/useNotices";
import { useSessions } from "@/hooks/useSessions";
import { useStableCallback } from "@/hooks/useStableCallback";
import { routeForSession } from "@/lib/sessionRoute";
import { useAgentAvailability, useMissingAgent } from "@/hooks/useAgentAvailability";
import AgentMissingNotice from "@/components/composer/AgentMissingNotice";
import LoginExpiredNotice from "@/components/composer/LoginExpiredNotice";
import type {
  AgentEvent,
  Attachment,
  Channel,
  PrListItem,
  SessionIndexItem,
  SessionSnapshot,
  WorktreeDisposition,
} from "@/types/events";
import { useRecorder } from "@/hooks/useTranscription";
import { useUpdater } from "@/hooks/useUpdater";
import { appendToDraft, writeDraft } from "@/hooks/useDraft";
import { authFailedTurn } from "@/lib/auth";
import { basename } from "@/lib/format";
import { focusComposer } from "@/lib/composerFocus";
import { sessionBranch } from "@/lib/pr";
import { setPrRefOpener } from "@/lib/prRef";
import { playCelebration } from "@/lib/sound";
import { worktreeNoticeDetail } from "@/lib/worktree";
import {
  EMPTY_VISITS,
  prune,
  step,
  visit,
  type VisitHistory,
} from "@/lib/tabVisitHistory";
import { UI_SCALE_STEP } from "@/lib/uiScale";
import { resetUiScale, zoomBy } from "@/hooks/useUiScale";
import { cn } from "@/lib/utils";
import { exportSession, type ExportFormat } from "@/lib/exportSession";


// Surfaces that only exist while the reader is acting on them — a dialog, the
// palette, a main-column page — load on first open instead of parsing at
// startup. Everything on the first-paint path stays static. A module's named
// exports ride the same chunk as its default, so opening one page pulls one
// file; they are separately `lazy` so each call site can suspend alone.
const CommandPalette = lazy(() => import("@/components/CommandPalette"));
const SettingsDialog = lazy(() => import("@/components/SettingsDialog"));
const PrsView = lazy(() => import("@/components/PrsView"));
const RoutinesView = lazy(() => import("@/components/RoutinesView"));
const PrDetail = lazy(() =>
  import("@/components/PrsView").then((m) => ({ default: m.PrDetail })),
);
const PrTabs = lazy(() =>
  import("@/components/PrsView").then((m) => ({ default: m.PrTabs })),
);
const AgentInbox = lazy(() => import("@/components/AgentInbox"));
const PluginsView = lazy(() => import("@/components/PluginsView"));

/// The events of no session, for the composer's context panel while there is
/// none. Module-level rather than a fresh `[]` per render: it is a prop, and a
/// new array each time would be a new prop identity on every event.
const EMPTY_EVENTS: AgentEvent[] = [];

/// The main-column pages, and the one value that says which is up.
///
/// **The set, so `none` is spelled once and every page is spelled once.** Reading
/// a page off this is what stops a question about pages being answered by a list
/// written out again at each site — see the state's own note.
type MainPage = "none" | "inbox" | "prs" | "plugins" | "routines" | "channels" | "profile";

function App() {
  const {
    selectedSessionId,
    selectedSession,
    sessions,
    streamingContentBlock,
    sessionIndexItems,
    statusBySession,
    slashCommands: slashCommandsForSession,
    askingSessions,
    showArchived,
    setShowArchived,
    harness,
    modelId,
    projects,
    projectPath,
    repoPath,
    targetPath,
    busy,
    backgroundTasks,
    liveTaskIds,
    compacting,
    apiRetry,
    working,
    error,
    setError,
    failUnlessLeft,
    pickProjectFolder,
    applyAgent,
    handleSelectProject,
    handleSendMsg,
    handleInterrupt,
    handleSendNow,
    queuedMessages,
    pendingAsks,
    handleCancelQueued,
    handleRespondPermission,
    handleAnswerQuestions,
    handleCancelQuestion,
    handleSelectSessionIndexItem: selectRawSession,
    handleNewSession,
    setSessionFlags,
    forkSession,
    deleteSession,
    removeWorktree,
    ensureLoaded,
    loadOlderEvents,
    setOnScreen,
    paneState,
    indexSide,
  } = useSessions();
  // there is nothing to say, so the composer sends as it always did.
  const missingAgent = useMissingAgent(harness);

  // The turn that died for want of a login, and whether the reader has already
  // been handed the cure for that one. Held by event id rather than by session:
  // a second failure mints a new id, so the notice comes back on its own
  // without anything having to clear a flag.
  const authTurn = useMemo(
    () => authFailedTurn(selectedSession?.events ?? []),
    [selectedSession?.events],
  );
  const [loginHandled, setLoginHandled] = useState<string | null>(null);
  // `useAgentAvailability` rather than `useMissingAgent`: that one answers only
  // for a CLI that is absent, and this agent's CLI ran well enough to report
  // being logged out.
  const agents = useAgentAvailability();
  const loggedOutAgent =
    authTurn && authTurn !== loginHandled
      ? (agents?.find((agent) => agent.harness === harness) ?? null)
      : null;

  const [collapsed, setCollapsed] = useLocalStorage("hz.sidebarCollapsed", false);
  // The sidebar's scope, not the composer's: `projectPath` decides where a new
  // session runs, and switching what you're *looking at* must not quietly move
  // where the next prompt would land.
  const [projectFilter, setProjectFilter] = useLocalStorage<string | null>(
    "hz.projectFilter",
    null,
  );
  // The workspace on screen. It is the outer scope the project filter sits
  // inside: it decides which agents are listed, and split groups are filed under
  // its id. `space` keeps the name the group code already reads it by.
  const { workspaces, active: activeWs, switchTo: switchWorkspace } = useWorkspaces();
  const space = activeWs?.id ?? null;
  const spaceProjects = projects;
  const {
    status: updateStatus,
    manual: updateManual,
    install: installUpdate,
    checkNow: checkForUpdates,
    channel: updateChannel,
    setChannel: setUpdateChannel,
  } = useUpdater();

  // Every session the app has started this run, not the open one: the install
  // relaunches the app, so any live child is one this would kill mid-turn. A
  // session from a previous run cannot still be running — no child survives a
  // restart — so the live map answers this on its own.
  //
  // The turn alone, never outstanding background tasks: a `local_bash` task
  // never ends, so a session running a dev server blocked the update for the
  // rest of its life with nothing saying why. Same reading Stop and fork take.
  const anyRunning = Object.values(statusBySession).some((s) => s === "in_progress");


  /// Where ⌘[ and ⌘] walk. Held here rather than in a store because it dies with
  /// the window and nothing else reads it — see [tabVisitHistory](lib/tabVisitHistory.ts).
  const [visits, setVisits] = useState<VisitHistory>(EMPTY_VISITS);
  /// Set while a step is being taken, so the recording effect below does not
  /// push the session the step just moved to — which would erase the forward
  /// trail the step was walking.
  const steppingVisit = useRef(false);


  /// The sessions the index holds, which is what ⌘[ and ⌘] may land on.
  ///
  /// A session it does not hold cannot be opened at all — selecting one goes
  /// through the not-found rollback — so stepping over such an entry is what
  /// keeps the key honest. Cost, stated: the index carries one side of the
  /// archived split, so a trail entry on the other side is stepped over.
  const liveSessions = useMemo(
    () => new Set(sessionIndexItems.map((item) => item.sessionId)),
    [sessionIndexItems],
  );

  useEffect(() => {
    if (!selectedSessionId) return;
    if (steppingVisit.current) {
      steppingVisit.current = false;
      return;
    }
    setVisits((prev) => visit(prev, selectedSessionId));
  }, [selectedSessionId]);

  useEffect(() => {
    // The same object comes back where nothing has died, so this is a no-op on
    // every ordinary index change.
    setVisits((prev) => prune(prev, liveSessions));
  }, [liveSessions]);

  // **One value, not a flag per page.**
  //
  // The main column shows one page at a time and the pages are a fixed set, so the
  // state is *which one* and the three flags below are read off it. They used to
  // be three `useState(false)`s kept in step by hand, and every question about
  // "is a page up" had to name all three: the composer's own guard named two, so
  // the third page arrived with the composer still drawn under it — and the same
  // list had to be remembered again at the reset key, in each opener and in ⌘W's
  // guard. A set that can only be spelled once cannot be half-remembered.
  //
  // A page is not a session and not a per-session tab: it is a place the reader
  // goes and comes back from, with the session they were in still there when they
  // do. That is why none of this moves the selection.
  const [page, setPage] = useState<MainPage>("none");
  const inboxOpen = page === "inbox";
    const prsOpen = page === "prs";
  const pluginsOpen = page === "plugins";
  const [profileOpen, setProfileOpen] = useState(false);
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const [callAgentId, setCallAgentId] = useState<string | null>(null);
  /// Whose profile the page shows, and on which tab. Kept when the page closes,
  /// so coming back from the chat lands where the reader left.
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);
  const [profileTab, setProfileTab] = useState<"details" | "library" | "computer">("details");
    // Pages the sidebar links to that a later phase builds: they draw a note and
  // nothing else, and close like the usage page does.
  const placeholderOpen = page === "channels";
  /// The channel the Channels page shows, and the card that makes or edits one.
  /// Kept when the page closes, so coming back lands where the reader left.
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channelDialog, setChannelDialog] = useState<{ editing: Channel | null } | null>(null);
  const channels = useChannels(activeWs?.id ?? null);
  const liveChannels = useMemo(() => channels.filter((c) => !c.archived), [channels]);
  const activeChannel = liveChannels.find((c) => c.id === channelId) ?? null;

  /// Pages are lazy chunks, so a page mounts on its first open and then stays
  /// mounted — the same hidden-not-unmounted bargain its `TabBody` makes.
  /// Before the first open there is no state to keep, so not mounting it is
  /// the same behavior at none of the parse cost.
  const [seenPages, setSeenPages] = useState<MainPage[]>([]);
  useEffect(() => {
    if (page !== "none") setSeenPages((prev) => (prev.includes(page) ? prev : [...prev, page]));
  }, [page]);
  const pageSeen = (p: MainPage) => seenPages.includes(p);
  /// **The repository the page lists, which is the session's own checkout.** A
  /// listing is one `gh` call per repository, and the question the page answers
  /// is about the code in front of the reader — the sidebar's marks can span
  /// projects because a mark is one query per repo and a row only needs a glyph.
  ///
  /// **Every repository this app is working in, which is what the page lists.**
  ///
  /// The candidate set is what the app already knows about repositories: each
  /// attached project (which may be a repository itself), and the checkout of
  /// every session in the active space — a spawned session's worktree is a
  /// checkout of the same repository, so it resolves to the project it came from
  /// rather than adding a second row for the same repo.
  ///
  /// Nothing here is probed: a project that is a *workspace* is not a repository,
  /// and `gh` is what says so — the page draws its rows from whichever
  /// repositories answered.
  const prsCwds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const project of spaceProjects) {
      for (const cwd of [project.path, project.path === repoPath ? repoPath : ""]) {
        if (!cwd || seen.has(cwd)) continue;
        seen.add(cwd);
        out.push(cwd);
      }
    }

    // The composer's own target leads where it names one: it is the repository
    // the reader is pointed at, and the page opening on it is the useful answer.
    const preferred = selectedSession?.cwd ?? repoPath ?? targetPath;
    if (preferred && seen.has(preferred)) {
      out.splice(out.indexOf(preferred), 1);
      out.unshift(preferred);
    }

    return out;
  }, [spaceProjects, selectedSession?.cwd, repoPath, targetPath]);


  // `all` is the state a reader reaches for next, and the one they wait on: one
  // `gh` per repository, fired at launch so that page is a filter over rows
  // already in hand by the time anybody presses it. Fire and forget — nothing
  // draws its answer until that state is actually asked for.
  //
  // Keyed on the joined paths, because the memo above hands back a fresh array
  // whenever its own inputs move: the *set* of repositories is what this cares
  // about, the same reason the pages key their own reads on a joined string.
  const prsCwdsKey = prsCwds.join("\n");
  useEffect(() => {
    void prefetchPrList(prsCwds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prsCwdsKey]);

  /// **The pull requests the pane is holding, in the order they were opened.**
  /// Held here so the list and the pane cannot disagree about which one is
  /// showing.
  ///
  /// A list rather than one row, because opening a second used to throw the
  /// first away: comparing two attempts at the same fix, or reading a pull
  /// request while its predecessor is still worth looking at, is the ordinary
  /// reason to want both. `activePrKey` is the tab on screen and the only one
  /// that reads — see `PrDetail`.
  const [openedPrs, setOpenedPrs] = useState<PrRow[]>([]);
  const [activePrKey, setActivePrKey] = useState<string | null>(null);

  /// **The run the Actions pane is showing, and it is one at a time.** Unlike a
  /// pull request — several of which stay open as tabs, because comparing two
  /// attempts at one fix is the ordinary reason to want both — a run is read at
  /// one moment and answered once: which step failed. Held by `App` because the
  /// pane is drawn beside the page, so a pick the page kept could not open it.


  /// Opens a pull request, or brings the tab it already has to the front.
  const openPr = (pr: PrRow) => {
    const key = prKey(pr);
    setOpenedPrs((prev) => (prev.some((open) => prKey(open) === key) ? prev : [...prev, pr]));
    setActivePrKey(key);
  };

  /// Closes one tab, and **the neighbour takes over** — the one to its left, or
  /// the one that was to its right when it was first. Same rule the files view's
  /// strip takes, so a closed tab lands the reader where they were rather than
  /// nowhere.
  const closePr = (key: string) => {
    const at = openedPrs.findIndex((pr) => prKey(pr) === key);
    if (at === -1) return;

    const next = openedPrs.filter((_, i) => i !== at);
    setOpenedPrs(next);
    if (activePrKey !== key) return;

    const neighbour = next[at - 1] ?? next[at] ?? null;
    setActivePrKey(neighbour ? prKey(neighbour) : null);
  };

  /// Opens the pull request a message named. What a chip in the prose does.
  ///
  /// **The page comes forward first and the read follows it.** The press is
  /// then instant and the pane fills when `gh` answers, rather than the reader
  /// watching nothing happen for half a second and then a page arrive.
  ///
  /// **By number, not by looking in the listing the page already holds.** A
  /// merged pull request is not in the open listing and a message naming one is
  /// ordinary — "merged #7" — so a lookup would work everywhere except the case
  /// that sends the reader here.
  const openPrRef = useCallback(
    async ({ sessionId, number }: { sessionId: string | null; number: number }) => {
      // The session the message was written in is the repository; the number is
      // all the prose itself carries. An id that is not in the index is a
      // delegated run's view, which has no repository of its own and is read
      // from the session it was opened beside — so the selected one is what it
      // falls back to.
      const cwd =
        sessionIndexItems.find((item) => item.sessionId === sessionId)?.projectPath ??
        sessions.find((s) => s.sessionId === sessionId)?.projectPath ??
        selectedSession?.projectPath ??
        null;

      const fail = failUnlessLeft();
      setPage("prs");
      if (!cwd) {
        fail("That message names a pull request, and this session is not in a repository.");
        return;
      }

      try {
        const item = await invoke<PrListItem>("pull_request_by_number", { cwd, number });
        openPr({ ...item, cwd, repo: basename(cwd) });
      } catch (e) {
        fail(e);
      }
    },
    [sessionIndexItems, sessions, selectedSession, failUnlessLeft, openPr],
  );

  /// Writes the selected session out to a file the reader picks.
  ///
  /// **Cancelling is not an error.** `exportSession` answers `null` for a closed
  /// dialog, and this says nothing about it — an app that raises a complaint for a
  /// thing somebody decided not to do is arguing with them. Only a real refusal
  /// reaches `fail`.
  ///
  /// The index entry carries every fact the frontmatter needs and the event log
  /// carries none of them, so both are read here rather than reconstructed.
  const exportSessionById = useCallback(
    async (sessionId: string, format: ExportFormat) => {
      const item = sessionIndexItems.find((held) => held.sessionId === sessionId);
      if (!item) return;

      const fail = failUnlessLeft();
      try {
        // **The loaded log where there is one, and a read where there is not.**
        // The row's own menu exports a session this window may never have opened,
        // and writing an empty file from it would be worse than not offering the
        // item at all.
        let events = sessions.find((held) => held.sessionId === sessionId)?.events;
        if (!events) {
          const snapshot = await invoke<SessionSnapshot | null>("get_session_by_id", {
            sessionId,
          });
          events = snapshot?.events ?? [];
        }

        await exportSession(item, events, format);
      } catch (e) {
        fail(e);
      }
    },
    [sessionIndexItems, sessions, failUnlessLeft],
  );

  // The chip is drawn inside a message's markdown, four components below
  // anything that could hold a callback. Registered once, for `openLink`'s
  // reason — see `lib/prRef`.
  useEffect(() => {
    setPrRefOpener((ref) => void openPrRef(ref));
    return () => setPrRefOpener(null);
  }, [openPrRef]);
  /// The pull-requests page's own refresh, so ⌘R and a write made in the pane
  /// beside it can reach the listing. A ref rather than state: the page owns the
  /// read, and re-rendering the app each time it re-makes this handle would be a
  /// render per keystroke in its search box.
  const prsRefreshRef = useRef<(() => void) | null>(null);

  /// The plugins page's own refresh, so ⌘R can reach it. A ref for the reason the
  /// two above are: the page owns the read — which here can cost the agent child's
  /// first boot — and hands its handle up rather than being re-rendered to receive
  /// one.
  const pluginsRefreshRef = useRef<(() => void) | null>(null);

  // Not persisted: settings are opened to change something and closed again, so
  // reopening the app into them would be the app remembering the wrong half of
  // a session.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The palette, on the same terms: opened to do one thing and closed again.
  const [paletteOpen, setPaletteOpen] = useState(false);

  /// What the reader has typed into the palette, and what searching every kept
  /// log for it answered.
  ///
  /// `App` owns the query rather than the palette because the rows for a hit come
  /// from a read — and a read over every session this app has kept belongs
  /// somewhere that can debounce it and throw away an answer that arrived late.


  // Which tab the *next* open lands on. Reset to Appearance as settings close,
  // so a mic press that sent the reader to Transcription does not leave every
  // later ⌘, opening there too.
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");

  /// Opens Settings on the providers — where a reader whose model picker came up
  /// empty can actually do something about it. The section is set before the
  /// surface opens, so it draws on the right one rather than switching under the
  /// reader's eyes.
  const openProviderSettings = () => {
    setSettingsTab("clis");
    setSettingsOpen(true);
  };

  // Dictation writes into the composer's draft through the module-level store,
  // not through a prop: the controls reach `ChatInput` as an opaque node, so
  // they cannot hand it the text. Same bargain `useAttachments` makes.
  //
  // A press with no model downloaded opens settings on Transcription rather
  // than pulling hundreds of megabytes nobody asked for.
  const recorder = useRecorder({
    // Pinned when recording starts, so a dictation survives switching sessions
    // and still lands where it was spoken. Drafts are per session, so it is
    // waiting there on the way back.
    target: selectedSessionId,
    onText: (text, session) => {
      appendToDraft(session, text);
      // Straight back to typing: the words landed in a draft the reader is
      // most likely about to add to or send. Only where they are still looking
      // at the session they spoke into — a dictation outlives the screen it
      // began on, and focusing a composer holding somebody else's draft is
      // worse than not focusing at all.
      if (session === selectedSessionId) focusComposer();
    },
    onNeedsModel: () => {
      setSettingsTab("voice");
      setSettingsOpen(true);
    },
    // Drawn in the composer's own error slot, which is where every other thing
    // that went wrong with a message already reports.
    onMessage: setError,
  });

  // ⌘ only. `platformOnly` is what keeps this off ⌃D, which macOS already
  // assigns to delete-forward in every text field — including the composer this
  // shortcut is for. Enabled always: pressed with nothing downloaded it opens
  // settings, which is the answer the reader needs rather than a dead key.
  useHotkey("dictate", () => void recorder.toggle(), { platformOnly: true });

  const [worktreePrompt, setWorktreePrompt] = useState<WorktreePrompt | null>(null);

  // Reads what the removal would cost *before* deciding whether to ask, so a
  // worktree that isn't there any more — deleted by hand, or by a `claude` run
  // that had an exit prompt of its own — is tidied up without a question.
  // Asking about a directory the reader can no longer see is a question with
  // one answer.
  //
  // `ask` is the whole difference between the two routes in. Settling raises a
  // notice that expires into "keep it", because the reader was doing something
  // else and this is an offer. The settled bar's own button raises the dialog,
  // because there the reader asked for the deletion and is owed a confirm
  // naming what it costs.
  const askAboutWorktree = async (
    sessionId: string,
    worktreeName: string,
    title: string,
    ask: "notice" | "dialog",
  ) => {
    let disposition: WorktreeDisposition;
    try {
      disposition = await invoke<WorktreeDisposition>("worktree_disposition", { sessionId });
    } catch {
      // An offer, not a step: a session whose state can't be read keeps its
      // worktree and says nothing. The button on the settled bar is still
      // there to try again.
      return;
    }

    if (!disposition.exists) {
      // Skipping the question is right either way — there is nothing left to
      // weigh — but *who asked* still decides whether a failure is reported.
      // The dialog route is a button the reader pressed and watched close, so
      // a relocation that then fails has to say so, or that press is the click
      // with nothing to show for it this whole change is about. Settling asked
      // for nothing and hears nothing.
      removeWorktree(sessionId, ask === "dialog" ? "asked" : "tidy");
      return;
    }

    if (ask === "dialog") {
      setWorktreePrompt({ sessionId, worktreeName, disposition });
      return;
    }

    pushNotice({
      sessionId,
      kind: "worktree",
      // The action leads. This card arrives unasked-for while the reader is
      // doing something else, so the first line has to be what it wants rather
      // than what happened — "Settled …" reads as a receipt, and a receipt is
      // something you look away from.
      label: "Delete worktree?",
      detail: worktreeNoticeDetail(disposition),
      // Which task, named by its own title rather than the generated worktree
      // name: `calm-navy-beacon` names a directory the reader never chose,
      // where the title is the work they just settled.
      subject: title,
    });
  };
  // Themes and Shiki's engine are shared by every code surface, so they load
  // once here instead of on the first diff the user happens to open.
  const { pair: codeThemePair } = useCodeTheme();
  useEffect(() => warmHighlighter(codeThemePair), [codeThemePair]);

  // The chat derives this too, but the panel and the header count need it here
  // and the memo makes the second pass free.
  // The plan comes off the same walk as everything else — one pass over the

  // The strip is **this turn's** work: runs the agent is holding, and runs that
  // reported before the turn closed — dropping one the moment it lands reads as
  // the strip swallowing its own news. The next prompt retires them, since
  // whatever the agent was mid-way through, this turn is not going to finish it.
  //


  // Filtered here rather than inside the sidebar, so the list and the ⌘⇧↑/↓ walk
  // read one array. `projectPath` on the item is the repo root, so a worktree
  // session stays under the project it forked from.
  // The space is the outer scope and the filter the inner one, both applied
  // here: this list is what the sidebar draws, what the chords walk and what
  // the PR marks and the ready notice are read from, so narrowing it once is
  // the whole of "another space is running, out of sight".
  //
  // **Only an Agent's own session is a row.** A conversation is no longer the
  // unit — an Agent is — so a session no Agent owns is not listed, walked or
  // searched. They stay on disk untouched; they just have no one to belong to.
  const roster = useRoster();
  // **A workspace is a set of agents.** The space the reader has up decides which
  // agents are listed — by the agent's own workspace, not by the folder it works
  // in, since two workspaces can share a repository and still be two teams.
  const agentOrder = useSavedOrder(space, "agents");
  const workspaceAgents = useMemo(
    () => applyOrder(pinnedFirst(roster.agents.filter((a) => inWorkspace(a, space))), agentOrder),
    [roster.agents, space, agentOrder],
  );
  const agentSessionIds = useMemo(
    () => new Set(workspaceAgents.flatMap((a) => (a.sessionId ? [a.sessionId] : []))),
    [workspaceAgents],
  );
  // **The one door every "open this session" goes through** (a notice, a banner,
  // a search hit, the palette, an Inbox link). Only an agent's own chat is a page;
  // a channel thread or an unowned session has no view in the agent UI, so the
  // route stops there and says why instead of drawing a raw transcript.
  const handleSelectSessionIndexItem = useStableCallback(async (sessionId: string) => {
    const owners = new Set(roster.agents.flatMap((a) => (a.sessionId ? [a.sessionId] : [])));
    const route = routeForSession(sessionId, sessionIndexItems, owners, roster.agents.length > 0);
    if (route.kind === "blocked") {
      toast(route.reason);
      return;
    }
    await selectRawSession(sessionId);
  });
  const visibleSessions = useMemo(
    () =>
      sessionIndexItems.filter(
        (i) =>
          agentSessionIds.has(i.sessionId) &&
          (!projectFilter || i.projectPath === projectFilter),
      ),
    [sessionIndexItems, projectFilter, agentSessionIds],
  );

  // Split groups: frontend-only, filed under the space they were made in. A
  // member whose project has since left the space is not drawn, and a group
  // that leaves fewer than two is no group here. Not narrowed by the project
  // filter — the grid shows the whole group, and the sidebar's run narrows
  // itself to the rows it draws.
  const [groups, setGroups] = useLocalStorage<SplitGroup[]>(GROUPS_KEY, []);
  const spaceGroups = useMemo(() => {
    const shown = agentSessionIds;
    return groups
      .filter((g) => g.space === space)
      .map((g) => ({
        ...g,
        columns: g.columns.map((c) => c.filter((id) => shown.has(id))).filter((c) => c.length),
      }))
      .filter((g) => members(g).length >= 2);
  }, [groups, space, agentSessionIds]);

  // A deleted or archived member leaves its group. Gated on the *loaded* list
  // being the live one — not on `showArchived`, which flips before the live
  // list lands, so a switch back from Settled would prune every group against
  // the archived list still on screen. `null` covers launch, where the index
  // is empty for a moment.
  useEffect(() => {
    if (indexSide !== false) return;
    const present = new Set(sessionIndexItems.map((i) => i.sessionId));
    setGroups((prev) => pruneGroups(prev, present));
  }, [sessionIndexItems, indexSide, setGroups]);

  // Whether the reader has ever made a group. Written once and never cleared:
  // the sidebar's drag tip retires on it, and a group dissolving later does
  // not make the drag un-learned.
  const [splitLearned, setSplitLearned] = useLocalStorage("hz.splitLearned", false);
  useEffect(() => {
    if (groups.length > 0 && !splitLearned) setSplitLearned(true);
  }, [groups, splitLearned, setSplitLearned]);

  // Selecting a member is what activates a group; the selected session is the
  // focused pane, so every control that serves one session keeps doing so.
  const activeGroup = groupOf(spaceGroups, selectedSessionId);
  // One conversation keeps a readable floor whatever the panes beside it are
  // dragged to; a split holds several deliberately small ones, so the same
  // floor there would refuse the layout the reader asked for.
  useChatColumnFloor(!activeGroup);

  // The pane's open flag and tab pick are held per session: app-wide, a pane
  // opened on one session's PR sat blank beside the next session, which had
  // none, and was gone again on the way back. Not persisted, and a session
  // never opened holds no entry,
  // which is also what keeps a new task from inheriting whichever pane the
  // last session left up — the reads there have nothing to answer from until
  // the first turn lands.
  //

  /// Whether one of the main-column pages is up.
  ///
  /// A page fills the column the session's own views live in — Chat, Diff,
  /// Browser, Files — so every one of those asks *this* and not a named page.
  /// Read off the one value the pages are held in, so it cannot be a list that
  /// was written out again and came up short: it was, and the composer drew under
  /// a page for it.
  /// Apps and Routines are sheets over the conversation, not pages that replace it, so the
  /// chat stays up behind them and keeps its composer.
  const sheetPage: boolean = page === "plugins" || page === "routines" || page === "prs";
  const pageOpen: boolean = page !== "none" && !sheetPage;

  /// The transcript is actually on screen: no page over it, and not behind the
  /// pane at its wide size. What `Chat` and `SplitView` take as `active`, which
  /// is a question about being *seen* — a hidden transcript must not follow the
  /// stream or claim the chords that scroll it.
  const chatShown = !pageOpen;
  const memberKey = activeGroup ? members(activeGroup).join("\n") : "";
  const paneColumns = useMemo(
    () =>
      (activeGroup?.columns ?? []).map((column) =>
        column.flatMap((id) => sessionIndexItems.find((i) => i.sessionId === id) ?? []),
      ),
    [activeGroup, sessionIndexItems],
  );

  // What the composer names as its target in a grid: the focused session's
  // title, with its project in front where the panes span projects and a
  // title alone could belong to either.
  const composerTarget = (() => {
    if (!activeGroup || !selectedSession) return null;
    const projects = new Set(paneColumns.flat().map((i) => i.projectPath));
    return projects.size > 1
      ? `${basename(selectedSession.projectPath)} / ${selectedSession.title}`
      : selectedSession.title;
  })();

  // Every pane loaded and held: eviction and read-marking treat the whole grid
  // as on screen.
  useEffect(() => {
    const ids = memberKey ? memberKey.split("\n") : [];
    setOnScreen(ids);
    ids.forEach((id) => void ensureLoaded(id));
    // Both are rebuilt every render; the key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey]);

  const closeSessionPane = useStableCallback((sessionId: string) => {
    setGroups((prev) => closePane(prev, sessionId));
    if (sessionId !== selectedSessionId || !activeGroup) return;
    const next = members(activeGroup).find((id) => id !== sessionId);
    if (next) void handleSelectSessionIndexItem(next);
  });

  // The single view's own drop zone; a grid's panes draw theirs. The empty
  // column is one too, drawn whole: the drop opens the session, so there is
  // no side to the zone.
  const drag = useSessionDrag();
  const singleDrop =
    drag?.over && !activeGroup && drag.over.sessionId === (selectedSessionId ?? EMPTY_VIEW)
      ? {
          region: selectedSessionId ? drag.over.region : ("center" as const),
          label: dropLabel(spaceGroups, drag.over.sessionId, drag.sessionId, drag.over.region),
        }
      : null;

  // The search narrows what is drawn, and only that — the sidebar's own row is
  // where it is typed, but the list it filters is this one, so the ⌘⇧↑/↓ walk
  // below steps exactly the rows on screen.
  //

  // The sidebar's marks: one `gh` per repo on screen rather than one per row —
  // see `usePrMarks`. Distinct paths, and the *active* list's only: a settled
  // session is work the reader has already dealt with, so a repo that appears
  // nowhere but the archived list is one nobody is waiting to land. Marks
  // already fetched still draw over there, since the cache outlives this — what
  // is dropped is the spending, not the answer.
  const repoPaths = useMemo(
    () => (showArchived ? [] : [...new Set(visibleSessions.map((i) => i.projectPath))]),
    [showArchived, visibleSessions],
  );
  const prMarks = usePrMarks(repoPaths);

  // Which agent works on which branch, for the pull requests board's attribution.
  // Read off the roster's own sessions, so nothing is stored for it. A session
  // that is gone from the index drops out, and its PRs go unattributed.
  const prAgentBranches = useMemo(
    () =>
      roster.agents.flatMap((agent) => {
        const session = sessionIndexItems.find((i) => i.sessionId === agent.sessionId);
        const branch = session ? sessionBranch(session, null) : null;
        return session && branch ? [{ agentId: agent.id, projectPath: session.projectPath, branch }] : [];
      }),
    [roster.agents, sessionIndexItems],
  );

  // "This can land now" — raised off the sidebar's marks rather than the
  // panel's own read, which is the only way it can be noticed at all: the
  // panel's poll is gated on its tab being on screen, and a tab on screen is
  // exactly the case with nothing to announce.
  usePrReady({ sessions: visibleSessions, prFor: prMarks.prFor });


  // Who the header names: the agent whose conversation is open, or, on the
  // empty composer, the one the next message will start.
  const headerGlance = useAgentGlances(selectedSessionId ? [selectedSessionId] : [])[selectedSessionId ?? ""];
  const teamStatus = useTeamStatus();
  const headerAgent = selectedSessionId
    ? roster.agents.find((a) => a.sessionId === selectedSessionId)
    : roster.agents.find((a) => a.id === roster.pendingId);
  // What the open agent chat's messages need: whose chat it is, and what its
  // messages can do.
  const chatTimings = useMemo(
    () => timingsOf(selectedSession?.events ?? EMPTY_EVENTS),
    [selectedSession?.events],
  );
  const agentChat = useMemo(
    () =>
      selectedSessionId && headerAgent
        ? {
            agent: headerAgent,
            sessionId: selectedSessionId,
            cwd: selectedSession?.cwd ?? headerAgent.projectPath,
            timings: chatTimings,
            onReply: (draft: ReplyDraft) => {
              startReply(selectedSessionId, draft);
              focusComposer();
            },
            onOpenProfile: (agentId: string) => openProfile(agentId),
            onRoutine: (text: string) => {
              setRoutineDraft({ text, agentId: headerAgent.id, at: Date.now() });
              setPage("routines");
            },
          }
        : null,
    [selectedSessionId, headerAgent, selectedSession?.cwd, chatTimings, roster.agents],
  );

  const reply = useReplyDraft(selectedSessionId);

  /// Starts a fresh page in the open agent chat: a line across the transcript and
  /// everything above it folded. The log, the agent's session and its memory are
  /// untouched — only what the reader sees changes.
  const clearAgentChat = () => {
    if (!selectedSessionId || !headerAgent) {
      toast("Nothing to clear yet", { icon: <Eraser /> });
      return;
    }
    const last = selectedSession?.events.at(-1)?.seq ?? 0;
    clearPage(selectedSessionId, { seq: last + 1, ts: new Date().toISOString() });
    cancelReply(selectedSessionId);
    toast(`Fresh page. ${headerAgent.name} keeps its memory.`, { icon: <Eraser /> });
  };

  // An agent nobody has written to yet still opens as its chat: header, empty
  // transcript, composer at the bottom.
  const freshAgent = !selectedSession && Boolean(headerAgent);

  /// What Enter does in an agent's composer. A line that is one of hz's own
  /// commands is answered here — `/remember`, `/routine`, `/clear` never reach
  /// the agent — and `/ask` and `/handoff` become a sentence it acts on with its
  /// team tools. Anything else is sent as written, carrying the message the
  /// reader chose Reply on.
  const sendFromComposer = async (message: string, attachments: Attachment[]) => {
    const command = headerAgent ? parseHz(message) : null;
    let prompt = message;

    if (command && headerAgent) {
      switch (command.name) {
        case "clear":
          clearAgentChat();
          return;
        case "remember": {
          const text = command.args || reply?.text || "";
          if (!text) return void setError("Say what to remember: /remember the board meets on Fridays");
          try {
            await rememberInChat(headerAgent.id, text);
            toast(`${headerAgent.name} saved it to memory`, {
              icon: <Sparkles />,
              action: { label: "Open", onClick: () => openProfile(headerAgent.id, "memory") },
            });
          } catch (e) {
            setError(`Could not save the note: ${String(e)}`);
          }
          return;
        }
        case "routine":
          setRoutineDraft({ text: command.args, agentId: headerAgent.id, at: Date.now() });
          setPage("routines");
          return;
        case "ask":
        case "handoff": {
          const target = splitTeammate(command.args, workspaceAgents, headerAgent.id);
          if ("error" in target) return void setError(target.error);
          if (command.name === "ask" && !target.rest) return void setError(`Ask ${target.agent.name} what? /ask ${target.agent.name} <question>`);
          prompt =
            command.name === "ask" ? askPrompt(target.agent, target.rest) : handoffPrompt(target.agent, target.rest);
          break;
        }
      }
    }

    const target = replyFor(selectedSessionId);
    cancelReply(selectedSessionId);
    await handleSendMsg(
      prompt,
      attachments,
      target ? { seq: target.seq, text: target.text, agent: target.agent } : null,
    );
  };

  /// Writes a changed agent back to the roster, and tells the open chat when what
  /// changed is something its next message runs on.
  const changeAgent = (next: RosterAgent) => {
    if (!headerAgent) return;
    rosterAdd(next);
    // Pin to top writes the same order a drag does, so the two never disagree.
    if (next.pinned && !headerAgent.pinned && space) {
      void saveOrder(space, "agents", toFront(workspaceAgents.map((a) => a.id), next.id));
    }
    if (
      next.modelId !== headerAgent.modelId ||
      next.effort !== headerAgent.effort ||
      next.permission !== headerAgent.permission
    ) {
      applyAgent(next);
    }
  };

  const workingAgentIds = useMemo(
    () =>
      new Set(
        workspaceAgents.flatMap((a) =>
          a.sessionId && statusBySession[a.sessionId] === "in_progress" ? [a.id] : [],
        ),
      ),
    [workspaceAgents, statusBySession],
  );

  // The conversation is an agent's: it gets the agent's band over the chat.
  const isAgentChat = headerAgent?.sessionId != null && headerAgent.sessionId === selectedSessionId;


  // An open session's own directory, since project- and local-scoped commands
  // differ per repo and a session can be running somewhere the picker isn't
  // pointed — a worktree, or a project switched away from since. The `@` picker
  // resolves against the same directory for the same reason.
  const composerCwd = selectedSession?.cwd ?? projectPath;

  // The agent's own command list, as it pushed it for the session on screen —
  // there is nothing to ask for: mcode states it when a session opens and again
  // when it changes, and the app holds what arrived. `null` means its child has
  // not spoken yet, which the picker reads as "not yet" and keeps its menu shut
  // for, where an empty list would be drawn as "this agent publishes none".
  const slashCommands = slashCommandsForSession ?? [];
  const slashCommandsLoading = slashCommandsForSession === null;

  // A pull request appears because something happened, and the thing that
  // happens is a turn — the agent running `gh pr create`, or the reader opening
  // one in a browser while a turn was in flight. Nothing else re-reads: the
  // panel's poll is gated on the PR tab being visible *and* active, and that tab
  // is hidden exactly while the answer is "no PR", so the one state that needed
  // rechecking was the only one that could never self-heal.
  //
  // The falling edge, not `!busy`, or an idle session re-asks on every unrelated
  // render — and the session id rides along because `busy` is the *selected*
  // session's: switching from a running session to an idle one drops it without
  // any turn having ended.
  const lastTurn = useRef({ sessionId: selectedSessionId, busy });
  useEffect(() => {
    const prev = lastTurn.current;
    lastTurn.current = { sessionId: selectedSessionId, busy };
    if (prev.sessionId !== selectedSessionId || !prev.busy || busy) return;
    prMarks.refresh();
  }, [selectedSessionId, busy, prMarks.refresh]);

  /// **Beside the prompt, and that ordering is the whole of the wait.** The
  /// runtime's `create` starts a kickoff turn of its own — that is the extra
  /// `1 turn · 2.1k tokens` a reader can see on the band after their own turn
  /// has already finished, and it is the runtime evaluating the objective
  /// rather than an app that hung.
  ///
  /// Made while the reader's turn is still running, that kickoff is *queued*
  /// behind it and starts the instant the turn ends; made after, it starts from
  /// cold seconds later. Neither removes it: `create` always kicks off, and the
  /// one way to suppress the work is to pause the goal at once — which leaves a
  /// goal that never reaches `complete` on its own, a worse trade than a few
  /// seconds and a couple of thousand tokens.

  // A doc arriving on screen is re-read, because the watcher behind `DocsPanel`
  // only ever holds the *selected* session's files: anything written while the
  // reader was somewhere else was written unwatched. A turn ending needs no
  // rule of its own — the agent's write is exactly what the watcher sees.
  //





  // Same order the sidebar draws, so the walk matches the list even when the
  // sidebar is collapsed and there is nothing on screen to follow — project
  // list included, since that is what orders the groups it steps through.
  const ordered = useMemo(
    () =>
      sortSessions(
        visibleSessions,
        projects,
        // The same reading the sidebar groups by, and withheld on the same list
        // — the walk has to step the runs the eye is looking at.
        showArchived ? undefined : { statusBySession, asking: askingSessions },
        showArchived,
        showArchived ? [] : spaceGroups,
      ),
    [visibleSessions, projects, showArchived, statusBySession, askingSessions, spaceGroups],
  );

  // Wraps downward only. Falling off the bottom returns to the newest session,
  // which is where a walk through the whole list wants to end up; the top holds
  // instead, since arriving at the oldest session by pressing *up* past the
  // newest one reads as a mistake rather than as a wrap.
  //
  // Two chords walk it at two grains. ⌘⇧ steps every row; ⌘⌥ steps `units`,
  // where a group's run is one step — so from inside a group it lands on the
  // next group, or on the row past the last one, and enters a group on its
  // first pane.
  const stepThrough = (units: SessionIndexItem[][], delta: number) => {
    if (units.length === 0) return;
    const from = units.findIndex((u) => u.some((i) => i.sessionId === selectedSessionId));
    // No selection is the empty composer — either direction enters at the top.
    const next =
      from === -1
        ? 0
        : delta > 0
          ? (from + 1) % units.length
          : Math.max(from - 1, 0);
    const item = units[next][0];
    if (item.sessionId !== selectedSessionId) {
      void handleSelectSessionIndexItem(item.sessionId);
    }
  };
  const stepSession = (delta: number) =>
    stepThrough(ordered.map((i) => [i]), delta);
  // Headings, not split groups: with no grid on screen the chord used to be
  // ⌘⇧ under another name, stepping one row at a time and never reaching the
  // next project the way its own label promised.
  const units = useMemo(
    () =>
      sessionUnits(
        visibleSessions,
        projects,
        showArchived ? undefined : { statusBySession, asking: askingSessions },
        showArchived,
        showArchived ? [] : spaceGroups,
      ),
    [visibleSessions, projects, showArchived, statusBySession, askingSessions, spaceGroups],
  );
  const stepGroup = (delta: number) => stepThrough(units, delta);

  // The prompts the reader has sent here, for ↑ and ↓ in an empty composer.
  // Derived rather than stored: the log is already the list, and a copy would
  // start empty on every resume — the visit that wants it most.
  const promptHistory = useMemo(
    () => recalledPrompts(selectedSession?.events ?? []),
    [selectedSession?.events],
  );


  // Every way of arriving at a session, so none of them can forget to leave the
  // pages. The two sidebar buttons closed one and the chords beside them did not,
  // which made ⌘N and ⌘⇧↑/↓ look inert: they moved the selection under a column
  // still full of the old list, and the change only showed up on the way back. A page is
  // left as it was — its filters and its scroll come back with it — so this is a
  // navigation, not a dismissal.
  const goToSession = (go: () => void) => {
    setPage("none");
    go();
  };

  /// ⌘[ / ⌘]. Walks the trail rather than the list, which is the whole
  /// difference between "the session I was just in" and "the row above this
  /// one" — on a sidebar sorted by project and state, the two are rarely the
  /// same row.
  const stepVisit = (delta: number) => {
    const next = step(visits, delta, liveSessions);
    if (!next) return;
    // Before the selection moves, so the effect that records arrivals knows
    // this one is not an arrival.
    steppingVisit.current = true;
    setVisits(next.history);
    goToSession(() => void handleSelectSessionIndexItem(next.to));
  };

  // The pages share the main column, and **one value is what keeps them exclusive**
  // — there is no pair of flags left to get out of step, and no arm here that has
  // to remember to clear the others.
  //
  // `useCallback` because the palette's row table is memoized on its inputs, and
  // fresh closures there would rebuild it on every render.
  /// The one page that spans both trackers, so it is opened before either of
  /// the two it launches into — and it takes no selection, like the rest.
  const openInbox = useCallback(() => {
    setPage("inbox");
  }, []);
  const openPrs = useCallback(() => {
    setPage("prs");
  }, []);
  const openPlugins = useCallback(() => {
    setPage("plugins");
  }, []);
  const openRoutines = useCallback(() => {
    setPage("routines");
  }, []);
  const openChannel = useCallback((id: string) => {
    setChannelId(id);
    setPage("channels");
  }, []);
  const newChannel = useCallback(() => setChannelDialog({ editing: null }), []);
  // Which of the sidebar's places is lit.
  const sidebarPage: SidebarPage = inboxOpen
    ? "inbox"
    : prsOpen
      ? "prs"
      : pluginsOpen
        ? "plugins"
        : page === "routines" || page === "channels"
          ? page
          : null;

  /// Switches workspace, dropping notices that name a session of the one left.
  /// A card raised before the switch names an agent the reader has put away, and
  /// clicking it would open that transcript.
  const changeWorkspace = useStableCallback((id: string) => {
    switchWorkspace(id);
    setProjectFilter(null);

    const owners = new Map(roster.agents.map((a) => [a.sessionId, a.workspaceId]));
    for (const notice of getNotices()) {
      const owner = owners.get(notice.sessionId);
      if (owner && owner !== id) dismissNotice(notice.sessionId, notice.kind);
    }
  });

  /// Keeps what is on screen inside the workspace on screen: an open chat whose
  /// agent lives in another workspace is put away. Layout, not effect, so the
  /// switch never paints one frame of the chat it left.
  useLayoutEffect(() => {
    if (!selectedSessionId || !space) return;
    const owner = roster.agents.find((a) => a.sessionId === selectedSessionId);
    if (owner && owner.workspaceId !== space) goToSession(handleNewSession);
    // `goToSession` and `handleNewSession` are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, selectedSessionId, roster.agents]);

  /// Writes a session's settled or pinned flag and takes the sidebar wherever
  /// that write left the row.
  ///
  /// One function because there are two ways to unsettle — the sidebar row's
  /// menu and the composer's own bar — and they have to land in the same place.
  /// The bar reached `setSessionFlags` directly at first, which wrote the flag
  /// and nothing else: the row left the settled list it was drawn from, the
  /// view stayed settled, and the session the reader had just taken back was
  /// nowhere on screen.
  const handleSetSessionFlags = useStableCallback(
    async (sessionId: string, flags: { archived?: boolean; pinned?: boolean }) => {
    // Everything below describes a move the index has made. A failed write —
    // or one naming a session that is no longer there — has moved nothing, so
    // it gets no celebration, no worktree offer, and no navigation: the row is
    // still where it was, and `setSessionFlags` has already put the reason on
    // screen.
    if (!(await setSessionFlags(sessionId, flags))) return;

    if (flags.archived === true) {
      playCelebration();

      // Settling is the reader saying this work is done, which is the
      // one moment the worktree behind it is provably spare. Asked
      // after the flag write lands, so the question is about a task
      // that is already settled rather than a condition of settling it.
      const item = sessionIndexItems.find((i) => i.sessionId === sessionId);
      if (item?.worktreeName) {
        void askAboutWorktree(sessionId, item.worktreeName, item.title, "notice");
      }
    }
    // Settling the open session leaves nothing to look at but the
    // unsettle bar, so it goes back to the empty composer instead.
    if (flags.archived === true && sessionId === selectedSessionId) {
      goToSession(handleNewSession);
    } else if (flags.archived === false) {
      // The row has just left whichever list it was drawn from, so follow it to
      // the one it landed in and keep it selected — from the sidebar's menu the
      // reader pressed that row, and from the composer's bar they are reading
      // its transcript. Either way, losing it is losing the thing they acted on.
      //
      // Unconditional, and after the write. Unconditional because the guard it
      // replaces read `showArchived` from a closure captured before the await,
      // so a reader who opened the settled view while the write was in flight
      // was left in it with the row gone; setting a boolean to the value it
      // already holds costs nothing. After, because the flip is what triggers
      // the list refetch, and a refetch racing a write still in flight answers
      // from an index that has not moved yet.
      setShowArchived(false);
      goToSession(() => void handleSelectSessionIndexItem(sessionId));
    }
  },
  );

  const toggleSidebar = useStableCallback(() => setCollapsed((prev) => !prev));

  // The memoized surfaces — the sidebar and the split panes — compare the
  // callbacks they take, so each one's identity has to outlive App's per-delta
  // renders. Only props of those two are stabilized here; everything else keeps
  // its fresh closure. The hook's own handlers are rebuilt every render, so the
  // ones a memoized surface receives go through the wrapper under new names.
  const openSettingsAt = useStableCallback((tab?: SettingsTab) => {
    if (tab) setSettingsTab(tab);
    setSettingsOpen(true);
  });
  const openPalette = useStableCallback(() => setPaletteOpen(true));
  const openSessionById = useStableCallback((id: string) =>
    void handleSelectSessionIndexItem(id),
  );
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  // A name Jump to carried over from a search that found nothing.
  const [newAgentName, setNewAgentName] = useState("");
  // The agent whose settings are open, or null. Separate from `newAgentOpen`:
  // the same form serves both, but only one is ever up.
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const settingsAgent = roster.agents.find((a) => a.id === settingsAgentId) ?? null;

  const [editAgentId, setEditAgentId] = useState<string | null>(null);
  const editAgent = roster.agents.find((a) => a.id === editAgentId) ?? null;

  const openNewAgent = useStableCallback(() => setNewAgentOpen(true));
  // Creating an Agent marks it pending and opens the empty composer: the session
  // does not exist until the first prompt, and that mint is where it is bound.
  const saveAgentSettings = useStableCallback((draft: AgentDraft) => {
    if (!settingsAgent) return;
    const updated = { ...settingsAgent, ...draft };
    rosterAdd(updated);
    setSettingsAgentId(null);
    // The open chat follows the new model at its next message.
    if (updated.sessionId === selectedSessionId) applyAgent(updated);
  });
  const createAgent = useStableCallback(
    (draft: Parameters<typeof newAgent>[0], id: string) => {
      const agent = newAgent(draft, id);
      rosterAdd(agent);
      rosterSetPending(agent.id);
      // Its computer is made now, in the background, and left asleep: nobody waits on it.
      void kit.vmEnsure(agent.id).catch(() => {});
      setNewAgentOpen(false);
      goToSession(handleNewSession);
      // After, not before: `handleNewSession` puts the composer back on the
      // reader's remembered harness, and this agent was made on its own.
      applyAgent(agent);
      // Settings → Agent defaults → Say hello on create.
      if (activeWs?.defaults.sayHello !== false) setGreeting({ id: agent.id, prompt: INTRO_PROMPT });
    },
  );
  // The agent just made, waiting to say hello. A send reads the composer's own
  // harness, folder and model, and those only take the agent's values on the
  // render after `applyAgent`, so the greeting is sent from an effect that waits
  // for them to agree rather than from the click.
  const [greeting, setGreeting] = useState<{ id: string; prompt: string } | null>(null);
  useEffect(() => {
    if (!greeting) return;
    const agent = roster.agents.find((a) => a.id === greeting.id);
    if (!agent || agent.sessionId) return setGreeting(null);

    const ready =
      !selectedSessionId &&
      roster.pendingId === agent.id &&
      harness === agent.harness &&
      projectPath === agent.projectPath &&
      (agent.modelId === null || modelId === agent.modelId);
    if (!ready) return;

    setGreeting(null);
    void handleSendMsg(greeting.prompt);
  });
  /// Opens an agent's profile, on `tab`, docked beside its chat.
  const openProfile = useStableCallback((id: string, tab: ProfileTab = "overview") => {
    setProfileAgentId(id);
    setProfileTab(tab === "computer" ? "computer" : tab === "activity" ? "library" : "details");
    setProfileOpen(true);
    openAgentChat(id);
  });
  const profileAgent = roster.agents.find((a) => a.id === profileAgentId) ?? null;
  // The inbox files a finished turn as news only when its chat was not the one
  // in front of the reader, so the backend is told which that is.
  useEffect(() => {
    const report = () => reportViewing(page === "none" && document.hasFocus() ? selectedSessionId : null);
    report();
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
    };
  }, [page, selectedSessionId]);
  // The profile writes straight to the roster. When the agent is the one whose
  // chat is selected, the composer follows its model, effort and stance too;
  // any other agent picks them up when its row is opened.
  const changeProfileAgent = useStableCallback((next: RosterAgent) => {
    const before = roster.agents.find((a) => a.id === next.id);
    rosterAdd(next);
    if (
      next.sessionId !== null &&
      next.sessionId === selectedSessionId &&
      (before?.modelId !== next.modelId || before?.effort !== next.effort || before?.permission !== next.permission)
    ) {
      applyAgent(next);
    }
  });
  // An agent crossing 80% or 100% of its budget is news wherever the reader is.
  useEffect(() => {
    const off = listen<{ agentId: string; agentName: string; state: string; spentUsd: number; budgetUsd: number }>(
      "agent_budget",
      ({ payload: b }) =>
        toast(
          b.state === "paused"
            ? `${b.agentName} is paused: US$ ${b.spentUsd.toFixed(2)} of its US$ ${b.budgetUsd} budget`
            : `${b.agentName} has used 80% of its US$ ${b.budgetUsd} budget`,
          { ms: 9000, action: { label: "Open", onClick: () => openProfile(b.agentId, "access") } },
        ),
    );
    return () => void off.then((f) => f()).catch(() => {});
  }, [openProfile]);
  // An agent's `create_agent`: made here, where the roster lives, and the reader stays in the chat they are in.
  // `rosterAdd` mirrors the roster to the backend first, so the maker can message the new agent at once.
  const makeRequestedAgent = useStableCallback((req: AgentCreateRequest) => {
    const made = agentFromRequest(req, roster.agents);
    if (typeof made === "string") return void kit.agentCreated(req.requestId, null, made).catch(() => {});
    rosterAdd(made);
    void kit.vmEnsure(made.id).catch(() => {});
    void kit.agentCreated(req.requestId, made.id).catch(() => {});
    toast(`${made.name} joined the team`, { ms: 6000, action: { label: "Open", onClick: () => openProfile(made.id) } });
  });
  useEffect(() => {
    const off = listen<AgentCreateRequest>("agent_create_request", ({ payload }) => makeRequestedAgent(payload));
    return () => void off.then((f) => f()).catch(() => {});
  }, [makeRequestedAgent]);

  // An Agent that has never been sent anything has no session to select, so its
  // row opens the same empty composer, pending on it.
  const openAgent = useStableCallback((id: string) => {
    rosterSetPending(id);
    goToSession(handleNewSession);
    const agent = roster.agents.find((a) => a.id === id);
    if (agent) applyAgent(agent);
  });
  /// An agent's chat from anywhere: its conversation when it has one, else the
  /// empty composer pending on it.
  const openAgentChat = useStableCallback((id: string) => {
    const agent = roster.agents.find((a) => a.id === id);
    if (agent?.sessionId) selectFromSidebar(agent.sessionId);
    else openAgent(id);
  });
  /// **Where the app opens.** The last place the reader was in this workspace, or
  /// the fallback chain in `lib/landing.ts`; the blank "new session" composer is
  /// never a destination. One effect covers a launch, a workspace switch and
  /// every way the screen can lose its subject (agent removed, channel archived,
  /// chat closed, session gone), because they all end in the same blank state.
  const [lastViewRaw, setLastView] = usePreference("hz.lastView", null);
  const lastView = useMemo(() => readLastView(lastViewRaw), [lastViewRaw]);
  const channelsLoaded = useChannelsLoaded();
  const [indexWaited, setIndexWaited] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setIndexWaited(true), 2000);
    return () => window.clearTimeout(t);
  }, []);
  const homeReady = space !== null && channelsLoaded && (indexSide !== null || indexWaited);
  const homeBlank =
    (page === "none" && !selectedSessionId && !roster.pendingId) ||
    (page === "channels" && !activeChannel);
  const emptyHome = homeBlank && homeReady && workspaceAgents.length === 0 && liveChannels.length === 0;
  const sidebarAgents = useMemo(() => {
    const names = displayNames(workspaceAgents);
    return workspaceAgents.map((a) => (names.get(a.id) === a.name ? a : { ...a, name: names.get(a.id) ?? a.name }));
  }, [workspaceAgents]);
  const landedFor = useRef<string | null>(null);
  const settlingView = useRef(false);
  const tried = useRef(new Map<string, number>());

  const landOn = useStableCallback((target: ViewTarget | null) => {
    if (!target) return;
    if (target.kind === "agent") return openAgentChat(target.id);
    // A channel or page opens over an agent's chat, so closing it never drops
    // the reader onto nothing.
    const under = resolveLanding({ stored: null, agents: landingAgents, channelIds: [] });
    if (under) openAgentChat(under.id);
    if (target.kind === "channel") openChannel(target.id);
    else setPage(target.id as MainPage);
  });
  const landingAgents = useMemo(
    () =>
      workspaceAgents
        .filter((a) => a.sessionId === null || liveSessions.has(a.sessionId) || indexSide !== false)
        .map((a) => {
          const item = a.sessionId ? sessionIndexItems.find((i) => i.sessionId === a.sessionId) : undefined;
          const modified = item ? Date.parse(item.modified) : Number.NaN;
          return { id: a.id, modified: Number.isNaN(modified) ? null : modified };
        }),
    [workspaceAgents, liveSessions, indexSide, sessionIndexItems],
  );
  const landingChannelIds = useMemo(() => liveChannels.map((c) => c.id), [liveChannels]);

  useEffect(() => {
    if (!homeReady || !space) return;
    const switched = landedFor.current !== space;
    if (!switched && !homeBlank) return;
    const go = () => {
      landedFor.current = space;
      settlingView.current = switched;
      // An agent whose chat just failed to open would otherwise be chosen again
      // by the next blank frame, forever.
      const now = Date.now();
      const agents = landingAgents.filter((a) => now - (tried.current.get(a.id) ?? 0) > 5000);
      const target = resolveLanding({
        stored: switched ? storedFor(lastView, space) : null,
        agents,
        channelIds: landingChannelIds,
      });
      if (target?.kind === "agent") tried.current.set(target.id, now);
      landOn(target);
    };
    if (switched) return go();
    // A send claims the pending agent and selects its session in two steps; a
    // beat of blank between them is not a reason to move the reader.
    const t = window.setTimeout(go, 60);
    return () => window.clearTimeout(t);
    // `landOn` is stable; the rest is what the choice reads.
  }, [homeReady, space, homeBlank, landOn, lastView, landingAgents, landingChannelIds]);

  useEffect(() => {
    if (!homeReady || !space) return;
    if (settlingView.current) {
      settlingView.current = false;
      return;
    }
    let target: ViewTarget | null = null;
    if (page === "none") {
      const id = headerAgent?.id;
      if (id && workspaceAgents.some((a) => a.id === id)) target = { kind: "agent", id };
    } else if (page === "channels") {
      if (activeChannel) target = { kind: "channel", id: activeChannel.id };
    } else if ((RESTORABLE_PAGES as readonly string[]).includes(page)) {
      target = { kind: "page", id: page };
    }
    if (!target) return;
    const next = withView(lastView, space, target);
    if (next !== lastView) setLastView(next);
  }, [homeReady, space, page, headerAgent?.id, workspaceAgents, activeChannel, lastView, setLastView]);

  /// The chat with words already in the composer, for "Ask Ada something".
  const askAgent = useStableCallback((id: string, text: string) => {
    openAgentChat(id);
    const agent = roster.agents.find((a) => a.id === id);
    writeDraft(agent?.sessionId ?? null, text);
    window.setTimeout(focusComposer, 80);
  });
  const selectFromSidebar = useStableCallback((sessionId: string) =>
    goToSession(() => {
      const agent = roster.agents.find((a) => a.sessionId === sessionId);
      if (agent) applyAgent(agent);
      void handleSelectSessionIndexItem(sessionId);
    }),
  );
  const installUpdateFromRow = useStableCallback(() => void installUpdate());
  const paneSendNow = useStableCallback(handleSendNow);
  const paneRespondPermission = useStableCallback(handleRespondPermission);
  const paneAnswerQuestions = useStableCallback(handleAnswerQuestions);
  const paneCancelQuestion = useStableCallback(handleCancelQuestion);
  const paneFork = useStableCallback(forkSession);
  const paneDelete = useStableCallback(deleteSession);

  // The callback bundle every split pane's transcript takes. Memoized because
  // `SplitView` is: a stable object is the difference between the panes
  // re-rendering and the grid being skipped outright.
  const paneChatProps = useMemo(
    () => ({
      onOpenSession: openSessionById,
      onSendNow: paneSendNow,
      onRespondPermission: paneRespondPermission,
      onAnswerQuestions: paneAnswerQuestions,
      onCancelQuestion: paneCancelQuestion,
      onLoadOlder: loadOlderEvents,
    }),
    [
      openSessionById,
      paneSendNow,
      paneRespondPermission,
      paneAnswerQuestions,
      paneCancelQuestion,
      loadOlderEvents,
    ],
  );

  useHotkey("sidebar.toggle", toggleSidebar);
  // Takes the sidebar with it: the field lives there, and a chord that opened a
  // search nobody can see would be worse than no chord. `autoFocus` covers the
  // field this press mounts; the select covers the one already on screen, which
  // is also what makes ⌘F on a query a replace rather than an append.
  // **The chord opens the view, not a field in the sidebar.** One screen holds the
  // box, the scopes and the results, and it opens from a collapsed sidebar as
  // readily as from an open one.
  useHotkey("session.new", () => setNewAgentOpen(true));
  // ⌘⇧ rather than plain ⌘: the composer is focused most of the time, where
  // ⌘↑/↓ is the webview's own jump-to-start/end of the input.
  useHotkey("session.prev", () => goToSession(() => stepSession(-1)));
  useHotkey("session.next", () => goToSession(() => stepSession(1)));
  // Bound only where there is somewhere to go: `useHotkey` claims every chord it
  // matches, and a ⌘[ that eats the key and does nothing is worse than one the
  // app never had.
  useHotkey("visit.back", () => stepVisit(-1), {
    enabled: step(visits, -1, liveSessions) !== null,
  });
  useHotkey("visit.forward", () => stepVisit(1), {
    enabled: step(visits, 1, liveSessions) !== null,
  });
  useHotkey("group.prev", () => goToSession(() => stepGroup(-1)));
  useHotkey("group.next", () => goToSession(() => stepGroup(1)));
  // ⌘W closes the open pull request, or the page it is on.
  const closeTabOrPane = () => {
    if (placeholderOpen) return setPage("none");
    if (prsOpen && activePrKey) return closePr(activePrKey);
  };
  useHotkey("tab.close", closeTabOrPane, { enabled: placeholderOpen || (prsOpen && !!activePrKey) });
  // ⌘R re-reads whatever the panel is showing — the same one button in the tab
  // row, so the chord means "refresh this" and never "refresh a specific
  // thing". `panelRefresh` is null on the tabs with nothing to fetch, and the
  // pane being closed is a no-op: refreshing something invisible is
  // work with no way to see it land, and both panel hooks pause their reads
  // there anyway.
  //
  // Safe to take despite being the webview's reload, because `useHotkey` claims
  // every chord it matches — and the app has no Reload menu item, which on
  // macOS would swallow the key before the webview ever saw it.
  useHotkey("panel.refresh", () => {
    // "Re-read what I am looking at", the same rule the session case follows:
    // the pane wins where one is open, and the list has it otherwise.
    if (prsOpen) return prsRefreshRef.current?.();
    if (pluginsOpen) return pluginsRefreshRef.current?.();
  });
  // ⌘, — every macOS app's preferences chord, and the only way into settings
  // while the sidebar is collapsed and its gear gone with it. Safe to take for
  // `useHotkey`'s usual pair of reasons: it claims the chord, and the app's
  // custom menu carries no Settings item to swallow the key first.
  //
  // **A toggle now that settings owns the window.** While it was a card the two
  // meanings were the same press — the reader could still see the app they came
  // from — and covering the whole window makes the chord that opened it the
  // first one somebody presses to get back. Escape does the same thing, from a
  // hint nobody sees until they try it; the chord is the one they already know.
  useHotkey("settings", () => setSettingsOpen((open) => !open));
  // Opens, and does nothing where the page is already up — the same answer the
  // sidebar row gives, since that is the only other route in. Not a toggle:
  // nothing on that page opens the pane either (⌘E closes only there), and a
  // chord that closed it would have to pick somewhere to land, which is the
  // guess `goToSession` exists so nothing has to make.
  // ⌘⇧L, free and next to ⌘I by meaning rather than by letter: the two lists the
  // reader goes to when the branch in front of them has nothing to say.
  useHotkey("prs.open", openPrs);
  // ⌘⇧U, which nothing else here claims: ⌘⇧P is the chord that reads like the
  // name and belongs to `project.next`, and the row this opens is the third of
  // the lists the reader leaves a session for.
  useHotkey("plugins.open", openPlugins);
  // ⌘K, which nothing else here claims. A toggle, so the chord that opened the
  // box closes it — the same reasoning settings follows.
  useHotkey("palette.open", () => setPaletteOpen((open) => !open));
  // Bound here rather than inside `useUiScale`, so the store stays free of
  // React and the three rows stay in the registry with every other chord —
  // which is what puts them in the Shortcuts tab and the palette.
  useHotkey("zoom.in", () => zoomBy(UI_SCALE_STEP));
  useHotkey("zoom.out", () => zoomBy(-UI_SCALE_STEP));
  useHotkey("zoom.reset", resetUiScale);

  /// Everything the palette can reach, in the order it should be read.
  ///
  /// **An explicit table rather than a replay of the shortcut chords.** Firing a
  /// synthetic keystroke would be shorter, and it lies: a chord that is disabled
  /// in the current pane fires nothing, so the row would do nothing and say
  /// nothing. Every row here calls the same function its own chord calls, and a
  /// row that cannot apply is simply not built.
  const inboxSnapshot = useInbox();
  const paletteSources = usePaletteSources(
    paletteOpen,
    activeWs?.id ?? null,
    useMemo(() => workspaceAgents.map((a) => a.id), [workspaceAgents]),
  );
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const rows: PaletteItem[] = [];

    // Jump to's own groups. `arrange` gathers every row under its group, so the
    // order they are pushed in only matters inside one group.
    rows.push(
      ...jumpRows({
        agents: workspaceAgents,
        working: workingAgentIds,
        inbox: inboxSnapshot.items,
        notes: paletteSources.notes,
        routines: paletteSources.routines,
        plugins: paletteSources.plugins,
        now: Date.now(),
        go: {
          agent: openAgentChat,
          inbox: (id) => {
            setJumpTarget({ kind: "inbox", id });
            openInbox();
          },
          note: (agentId, note) => {
            setJumpTarget({ kind: "memory", agentId, note });
            openProfile(agentId, "memory");
          },
          routine: (id) => {
            setJumpTarget({ kind: "routine", id });
            openRoutines();
          },
          plugin: (id) => {
            setJumpTarget({ kind: "plugin", id });
            openPlugins();
          },
        },
      }),
    );

    // Sessions first and in the sidebar's own order: the palette is most often
    // used to go somewhere, and the list beside it has to agree about what is
    // near the top.
    for (const item of ordered) {
      rows.push({
        kind: "session",
        id: item.sessionId,
        label: item.title,
        detail: displayPath(item.projectPath),
        run: () => goToSession(() => void handleSelectSessionIndexItem(item.sessionId)),
      });
    }

    for (const project of projects) {
      rows.push({
        kind: "project",
        id: project.path,
        label: project.name,
        detail: displayPath(project.path),
        run: () => handleSelectProject(project.path),
      });
    }

    // Channels, and the archived ones as a way back: archiving promises Jump to
    // brings them home.
    for (const c of channels) {
      rows.push(
        c.archived
          ? {
              kind: "channel",
              id: c.id,
              label: `Restore #${c.name}`,
              detail: "archived",
              run: () =>
                void archiveChannel(c.id, false)
                  .then((back) => openChannel(back.id))
                  .catch((e) => toast(String(e))),
            }
          : {
              kind: "channel",
              id: c.id,
              label: `#${c.name}`,
              detail: c.purpose || undefined,
              icon: <ChannelTile color={workspaceAgents.find((a) => a.id === c.lead)?.color ?? "#8d8d88"} size={22} />,
              run: () => openChannel(c.id),
            },
      );
    }

    for (const w of workspaces) {
      if (w.id === space) continue;
      rows.push({ kind: "space", id: w.id, label: w.name, run: () => changeWorkspace(w.id) });
    }

    // The first six are the mockup's "Do" rows, in its order; only the ones with
    // a chord in the registry carry caps (`shortcut`), the rest have no key.
    const actions: { id: ShortcutId | null; key: string; label: string; icon?: ReactNode; run: () => void }[] = [
      { id: "session.new", key: "session.new", label: "New agent", icon: DO_ICONS.agent, run: () => setNewAgentOpen(true) },
      { id: null, key: "do.channel", label: "New channel", icon: DO_ICONS.channel, run: newChannel },
      {
        id: null,
        key: "do.routine",
        label: "New routine",
        icon: DO_ICONS.routine,
        run: () => {
          setJumpTarget({ kind: "routine", id: null });
          openRoutines();
        },
      },
      { id: "inbox.open", key: "inbox.open", label: "What's waiting for you", icon: DO_ICONS.inbox, run: openInbox },
      {
        id: null,
        key: "do.plugin",
        label: "Connect apps",
        icon: DO_ICONS.plugin,
        run: () => {
          setJumpTarget({ kind: "catalog" });
          openPlugins();
        },
      },
      { id: "prs.open", key: "prs.open", label: "Pull requests", icon: DO_ICONS.prs, run: openPrs },
      { id: "settings", key: "settings", label: "Settings", icon: DO_ICONS.settings, run: () => setSettingsOpen(true) },
      // The row and the chord do the same thing, which is what a palette row is
      // for — and it is the same thing whether or not the sidebar is up.
      { id: "sidebar.toggle", key: "sidebar.toggle", label: "Toggle the sidebar", icon: DO_ICONS.sidebar, run: toggleSidebar },
    ];


    for (const action of actions) {
      rows.push({
        kind: "action",
        id: action.key,
        label: action.label,
        icon: action.icon,
        shortcut: action.id ?? undefined,
        run: action.run,
      });
    }

    // **Pushed apart from the array above, because that array's ids *are* the
    // registry's.** A palette row draws its caps from the chord registry, so
    // every entry there carries an id that is a real binding — and an export has
    // no key. Naming one here would draw caps for a chord nobody can press.
    //
    // Two rows rather than one with a format picker behind it: the two things a
    // reader wants out of a session are a document and a log, and a dialog asking
    // which of two is worse than two rows that each say what they do.
    if (selectedSessionId && !pageOpen) {
      rows.push(
        {
          kind: "action",
          id: "session.export",
          label: "Export this session",
          run: () => void exportSessionById(selectedSessionId, "md"),
        },
        {
          kind: "action",
          id: "session.exportJson",
          label: "Export the event log",
          run: () => void exportSessionById(selectedSessionId, "json"),
        },
      );
    }

    return rows;
  }, [
    ordered,
    projects,
    workspaces,
    space,
    // Everything `closePagePane` reads, which the panel row now calls. The row
    // used to spell the guard out itself and needed none of these — and could not
    // be stale — but sharing the rule is worth naming what it depends on: a row
    // built from an old pick would close the wrong thing, or nothing.
    activePrKey,
    selectedSessionId,
    handleSelectSessionIndexItem,
    handleSelectProject,
    handleNewSession,
    toggleSidebar,
    changeWorkspace,
    openInbox,
    openPrs,
    openPlugins,
    exportSessionById,
    pageOpen,
    prsCwds,
        channels,
    openChannel,
    workspaceAgents,
    workingAgentIds,
    inboxSnapshot.items,
    paletteSources,
    openAgentChat,
    openProfile,
    openRoutines,
    newChannel,
  ]);

  const fullscreen = useFullscreen();
  useGlass(fullscreen);
  useStudioAttributes();

  /// The one thing that belongs at the window's left edge in the top row.
  ///
  /// A collapsed sidebar renders nothing, so whatever reaches that edge has to
  /// clear the traffic lights — the app header normally, and the pane's own row
  /// while the pane is wide and the header is hidden behind it. One node, drawn
  /// in whichever of the two is on screen, so the way back out of a collapsed
  /// sidebar never goes with it.
  const sidebarLead = collapsed && (
    <div
      className={cn(
        "flex shrink-0 items-center",
        // Fullscreen has no traffic lights, so the toggle pulls back past the
        // row's own padding to sit flush at the window edge.
        fullscreen ? "-ml-1" : "pl-(--traffic-lights-w)",
      )}
    >
      {/* No dev badge beside it: the badge lives at the sidebar's bottom edge
          now and shows nothing while the sidebar is collapsed, the same bargain
          `UpdateRow` makes — neither is urgent enough to earn a second home in
          this header. */}
      <SidebarToggle onToggle={toggleSidebar} collapsed />
    </div>
  );

  // The header's label off a page. A session draws its own name in the agent band below.
  const headerLabel = inboxOpen
    ? "Inbox"
    : page === "channels"
        ? activeChannel
          ? `#${activeChannel.name}`
          : "Channels"
        : "";

  return (
    <TooltipProvider>
    <DiffWorkerPool pair={codeThemePair}>
    <AppShell
      // A page fills the column, so the centred empty-composer state is wrong
      // there even with no session selected.
      centered={!selectedSession && !pageOpen && !freshAgent}
      overlay={singleDrop && <DropZone region={singleDrop.region} label={singleDrop.label} />}
      sidebar={
        <AgentSidebar
          agents={sidebarAgents}
          activeAgentId={profileOpen ? profileAgentId : pageOpen ? null : (headerAgent?.id ?? null)}
          page={sidebarPage}
          statusBySession={statusBySession}
          askingSessions={askingSessions}
          collapsed={collapsed}
          onToggleCollapsed={toggleSidebar}
          onOpenSettings={openSettingsAt}
          onOpenPalette={openPalette}
          onChangeWorkspace={changeWorkspace}
          onSelectSession={selectFromSidebar}
          onOpenAgent={openAgent}
onCallAgent={(id) => setCallAgentId(id)}
onAgentVersions={(id) => openProfile(id)}
onEditAgent={(id) => setEditAgentId(id)}
          onNewAgent={openNewAgent}
          onOpenInbox={openInbox}
          onOpenRoutines={openRoutines}
          onOpenPrs={openPrs}
          prNeedsYou={prMarks.needsYou}
          onOpenPlugins={openPlugins}
          onNewChannel={newChannel}
          channels={channels}
          activeChannelId={channelId}
          onOpenChannel={openChannel}
          onFork={paneFork}
          onDelete={paneDelete}
          onExport={exportSessionById}
          updateStatus={updateStatus}
          updateBlocked={anyRunning}
          updateManual={updateManual}
          onInstallUpdate={installUpdateFromRow}
        />
      }
      header={
        <header
          // `overflow-hidden` is the containment: whatever runs out of room in
          // here must clip at the column's edge, never spill over the pane
          // beside it. Every child below decides how it gives up width; this
          // decides that it has to.
          className={cn("flex h-(--titlebar-h) shrink-0 items-center gap-2 overflow-hidden px-3", headerAgent && (selectedSession ? isAgentChat : freshAgent) && !pageOpen && "border-b border-line")}
          // `deep`, not bare: bare drags only on direct hits, so every label
          // inside this row was a dead strip in a titlebar that looks uniform.
          // Buttons still block on their own — Tauri stops walking up at any
          // clickable element that carries no attribute of its own.
          data-tauri-drag-region="deep"
        >
          {sidebarLead}

          {headerAgent && (selectedSession ? isAgentChat : freshAgent) && !pageOpen ? (
        <AgentChatHeader
          agent={headerAgent}
          onChange={changeAgent}
          onOpenProfile={(tab) => openProfile(headerAgent.id, tab ?? "overview")}
          onExport={() => selectedSession && void exportSessionById(selectedSession.sessionId, "md")}
          onCall={() => setCallAgentId(headerAgent.id)}
          activity={
            pendingAsks.length
              ? "asking"
              : busy
                ? (headerGlance?.activity ?? "thinking")
                : (teamActivity(teamStatus, headerAgent.id)?.activity ?? null)
          }
          who={teamActivity(teamStatus, headerAgent.id)
            ?.who.map((id) => roster.agents.find((a) => a.id === id)?.name ?? "a teammate")
            .join(", ")}
          onClear={clearAgentChat}
          onRemove={() => {
            rosterRemove(headerAgent.id);
            goToSession(handleNewSession);
          }}
        />
          ) : (
            <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">{headerLabel}</span>
          )}

          {prsOpen && activePrKey && <PanelToggle onToggle={() => closePr(activePrKey)} open />}
        
        </header>
      }
      panel={
        // The pane describes whatever the main column is showing. On a page that
        // has its own pane the session's is hidden: left up, it went on describing
        // changes and a pull request belonging to work the reader had left.
        pluginsOpen ? null : prsOpen ? (
          <RightPanel
            open={openedPrs.length > 0}
            // The pane's tabs are the reader's pull requests rather than this
            // session's views, so the page brings the strip and the frame keeps
            // everything around it — see `RightPanel`'s `tabs`.
            tabs={
              <Suspense fallback={null}>
                <PrTabs
                  open={openedPrs}
                  active={activePrKey}
                  onActivate={openPr}
                  onClose={(pr) => closePr(prKey(pr))}
                />
              </Suspense>
            }
            // The page's own listing is re-read as well as this pane: a merge
            // changes the row's state, and a list still calling it open would be
            // the pane's own answer contradicted two inches away.
            refresh={{
              // Through the ref, not a copy of it: the page publishes its
              // refresh on every render, and a captured one would be the first
              // render's — a button that worked until the filters moved.
              onRefresh: () => prsRefreshRef.current?.(),
              loading: false,
            }}
          >
            {/* **Every open tab stays mounted, and only one reads.** `PrDetail`
                hands `active` to `usePullRequest`, which pauses its read while
                it is false — the same bargain the session's own tabs make, so
                ten open pull requests cost one `gh` call and ten kept scroll
                positions rather than ten calls a second. */}
            {openedPrs.map((pr) => (
              <TabBody key={prKey(pr)} active={prKey(pr) === activePrKey}>
                <Suspense fallback={null}>
                  <PrDetail
                    picked={pr}
                    active={prsOpen && prKey(pr) === activePrKey}
                    onChanged={() => {
                      prMarks.refresh();
                      prsRefreshRef.current?.();
                    }}
                  />
                </Suspense>
              </TabBody>
            ))}
          </RightPanel>
        ) : placeholderOpen ? (
          // A channel's panel is drawn by `ChannelView`, which owns what it shows, into this slot so it stands the full height of the window.
          <div ref={setPanelSlot} className="contents" />
        )
        : // Mounted whenever a session is, open or not — closing or switching
        // tabs only hides, so reopening shows what was already there instead of
        // refetching and re-highlighting it. `active` is what stops the hidden
        // changes tab from snapshotting the working tree in the background.
        profileOpen && profileAgent && !pageOpen ? (
        <ProfilePanel
          agent={profileAgent}
          working={profileAgent.sessionId !== null && statusBySession[profileAgent.sessionId] === "in_progress"}
          tab={profileTab}
          onTab={setProfileTab}
          onChange={changeProfileAgent}
          onClose={() => setProfileOpen(false)}
          onEditLook={() => setSettingsAgentId(profileAgent.id)}
          onEdit={() => setEditAgentId(profileAgent.id)}
          onRoutines={() => setPage("routines")}
        />
        ) : null
      }
      footer={
        // Only under the transcript it writes into: a page is not a
        // conversation, and a composer under one would send into a session the
        // reader cannot see. The pane's tabs need no such guard — they sit
        // *beside* the transcript rather than over it, so the composer stays.
        //
        // **`pageOpen`, never a list of the pages.** Every page hides the composer
        // for the same reason, and a list written out here is a list that comes up
        // short: this one named the pull-request page and not the
        // plugins one, so that page shipped with a composer under it — offering to
        // send into a session the reader had left. Safe to unmount: the draft, the
        // attachments and the fan-out set are module-level stores precisely
        // because the composer already unmounts crossing the empty state.
        //
        // A subagent view hides it too, and for a nearer reason: a delegated child
        // cannot be prompted at all — the agent publishes no way to send into one —
        // so a composer under it would be the one control on screen that lies
        // about what it does. The way back is the arrow in the header.
        pageOpen || homeBlank ? null : (
        <ChatInput
          onSend={(message, attachments) => void sendFromComposer(message, attachments)}
          replyBar={
            reply ? <ReplyBar draft={reply} onCancel={() => cancelReply(selectedSessionId)} /> : undefined
          }
          onCancelReply={() => cancelReply(selectedSessionId)}
          mentionAgents={
            headerAgent ? workspaceAgents.filter((a) => a.id !== headerAgent.id) : undefined
          }
          workingAgents={workingAgentIds}
          commands={headerAgent ? [...hzSlashCommands(), ...slashCommands] : slashCommands}
          commandsLoading={slashCommandsLoading}
          cwd={composerCwd}
          onStop={handleInterrupt}
          // Above the card and outside it: the strip names live work, and the
          // card's blur backdrops everything inside it — the same trap that
          // sends the pickers to the wrapper. Unmounted idle, so the composer
          // never moves for it.
          onCancelQueued={handleCancelQueued}
          onCancelRecording={() => {
            if (recorder.state !== "recording") return false;
            void recorder.cancel();
            return true;
          }}
          dictating={recorder.state !== "idle"}
          dictation={
            <DictateControl
              state={recorder.state}
              level={recorder.level}
              savedAudio={recorder.savedAudio}
              onStart={() => void recorder.start()}
              onStop={() => void recorder.stop()}
              onCancel={() => void recorder.cancel()}
              onRetry={() => void recorder.retry()}
              // Reveals rather than opens: the reader asking for the file wants
              // to keep it, play it, or send it on, and Finder is the one place
              // all three are reachable. Same reasoning `pickFileOpener` gives.
              onReveal={() =>
                recorder.savedAudio && void revealItemInDir(recorder.savedAudio)
              }
            />
          }
          queuedCount={queuedMessages.length}
          busy={busy}
          sessionId={selectedSessionId}
          isNewTask={!selectedSession && !freshAgent}
          target={composerTarget}
          // Walked by ↑/↓ in an empty box. The transcript is the history — no
          // second store to keep in step, and a resumed session arrives with its
          // prompts already in it.
          history={promptHistory}
          error={error}
          onDismissError={() => setError(null)}
          // The agent is blocked until this is answered, so it sits with the
          // composer rather than at the bottom of a transcript the reader may
          // have scrolled away from.
          ask={
            selectedSessionId && pendingAsks.length ? (
              <PendingAskPanel
                asks={pendingAsks}
                sessionId={selectedSessionId}
                onRespond={handleRespondPermission}
                onAnswer={handleAnswerQuestions}
                onCancelQuestion={handleCancelQuestion}
                autoFocus
                permissionsInChat={Boolean(headerAgent)}
              />
            ) : undefined
          }
          archived={selectedSession?.archived ?? false}
          onUnarchive={() =>
            selectedSessionId &&
            void handleSetSessionFlags(selectedSessionId, { archived: false })
          }
          // Only on a new task. An agent is fixed at creation, so a live
          // session cannot be pointed at one that is missing — and a session
          // that already exists has a CLI that already ran.
          notice={
            !selectedSessionId && missingAgent ? (
              <AgentMissingNotice agent={missingAgent} />
            ) : loggedOutAgent && authTurn && selectedSession ? (
              <LoginExpiredNotice
                agent={loggedOutAgent}
                cwd={selectedSession.cwd}
                onHandled={() => setLoginHandled(authTurn)}
                onOpenSettings={openProviderSettings}
              />
            ) : null
          }
              leading={
            <>
              <AttachButton onAttach={() => void pickAttachments(selectedSessionId)} />
            </>
          }
          placeholder={headerAgent ? (headerAgent.paused ? `${headerAgent.name} is paused. Messages wait here.` : `Message ${headerAgent.name}`) : undefined}
          recipient={headerAgent ? <></> : undefined}
        />
        )
      }
    >
      {/* One bad row costs one view rather than the window: the sidebar, the
          header and the composer are all outside this. Keyed on what the column
          is showing, so a caught error clears when the reader moves to another
          session or another page instead of latching until a reload. */}
      <RenderErrorBoundary
        resetKey={`${selectedSessionId ?? ""}:${page}`}
        subject="view"
      >
      {/* Hidden rather than unmounted, like everything else in this column:
          the list, its filters and its scroll survive a trip into a session and
          back, which is the trip this page exists to make. */}

      {pageSeen("prs") && (
      <>
        <Suspense fallback={null}>
          <PrsView
            cwds={prsCwds}
            active={prsOpen && !activePrKey}
            onClose={() => setPage("none")}
            refreshRef={prsRefreshRef}
            agentBranches={prAgentBranches}
            onAskAgent={askAgent}
            onWrite={() => prMarks.refreshAfterWrite()}
          />
        </Suspense>
      </>
      )}

      {pageSeen("inbox") && (
      <TabBody active={inboxOpen}>
        <Suspense fallback={null}>
          <AgentInbox
            active={inboxOpen}
            workspaceAgents={workspaceAgents}
            onOpenAgent={openAgentChat}
            onOpenProfile={(id) => openProfile(id)}
            onOpenAccess={(id) => openProfile(id, "access")}
            onAsk={askAgent}
          />
        </Suspense>
      </TabBody>
      )}
      {page === "channels" && (
      <TabBody active>
        {activeChannel ? (
          <ChannelView
            key={activeChannel.id}
            channelId={activeChannel.id}
            workspaceAgents={workspaceAgents}
            workspaceName={activeWs?.name ?? "this workspace"}
            active
            panelSlot={panelSlot}
            onEdit={(c) => setChannelDialog({ editing: c })}
            onOpenProfile={(id) => openProfile(id)}
            onMessageAgent={openAgentChat}
            onOpenInbox={openInbox}
            onArchived={() => setChannelId(null)}
            composer={{
              dictating: recorder.state !== "idle",
              onCancelRecording: () => {
                if (recorder.state !== "recording") return false;
                void recorder.cancel();
                return true;
              },
              dictation: (
                <DictateControl
                  state={recorder.state}
                  level={recorder.level}
                  savedAudio={recorder.savedAudio}
                  onStart={() => void recorder.start()}
                  onStop={() => void recorder.stop()}
                  onCancel={() => void recorder.cancel()}
                  onRetry={() => void recorder.retry()}
                  onReveal={() => recorder.savedAudio && void revealItemInDir(recorder.savedAudio)}
                />
              ),
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-s2 text-ink3">
              <Hash className="size-5" />
            </span>
            <h1 className="text-base font-semibold text-ink">Channels</h1>
            <p className="max-w-sm text-[13px] leading-normal text-ink3">
              Rooms where you and a few agents work on one thing together, with @mentions to pick who answers.
            </p>
            <Button size="sm" onClick={newChannel}>
              New channel
            </Button>
          </div>
        )}
      </TabBody>
      )}
      {pageSeen("routines") && (
      <>
        <Suspense fallback={null}>
          <RoutinesView
            active={page === "routines"}
            agents={roster.agents.filter((a) => inWorkspace(a, activeWs?.id ?? null))}
            allAgents={roster.agents}
            workspaceName={activeWs?.name ?? "this workspace"}
            channels={liveChannels.map((c) => ({ id: c.id, name: c.name }))}
            onOpenChat={(id) => {
              const agent = roster.agents.find((a) => a.id === id);
              if (agent?.sessionId) selectFromSidebar(agent.sessionId);
              else openAgent(id);
            }}
            onClose={() => setPage("none")}
          />
        </Suspense>
      </>
      )}


      {pageSeen("plugins") && (
      <>
        <Suspense fallback={null}>
          <PluginsView
            active={pluginsOpen}
            workspaceId={activeWs?.id ?? null}
            workspaceName={activeWs?.name ?? "this workspace"}
            agents={roster.agents.filter((a) => inWorkspace(a, activeWs?.id ?? null))}
            onOpenAccess={(id) => openProfile(id, "access")}
            refreshRef={pluginsRefreshRef}
            onClose={() => setPage("none")}
          />
        </Suspense>
      </>
      )}

      {/* Hidden rather than unmounted, the same bargain the right panel's tabs
          make: the transcript keeps its scroll position and its highlighted
          diffs across a trip into a page and back. */}
      <div className={cn("min-h-0 flex-1", pageOpen ? "hidden" : "flex")}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabBody active>
      {activeGroup ? (
        <SplitView
          columns={paneColumns}
          focusedId={selectedSessionId}
          paneState={paneState}
          groups={spaceGroups}
          onFocus={openSessionById}
          onClose={closeSessionPane}
          // `chatShown`, not `!pageOpen`: the pane at its wide size covers this
          // column too, and a transcript that is not on screen must not follow
          // the stream — a `scrollTop` written against a `display: none` element
          // lands at zero, which is what the reader would come back to. A subagent
          // view over it is the third way this column stops being on screen.
          active={chatShown}

          chat={paneChatProps}
        />
      ) : (
      // The single view is one drop target: a row let go here opens beside
      // the selected session, on whichever side it was let go.
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        {...{ [DROP_ATTR]: selectedSessionId ?? undefined }}
      >
      {homeBlank && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-10 text-center">
          {emptyHome && (
            <>
              <h1 className="text-base font-semibold text-ink">Create your first agent</h1>
              <p className="max-w-sm text-[13px] leading-normal text-ink3">
                Agents are teammates that keep their own conversation. Make one and it opens here.
              </p>
              <Button size="sm" onClick={openNewAgent}>
                New agent
              </Button>
            </>
          )}
        </div>
      )}
      {/* The band above is a sibling, so the transcript takes what is left. */}
      <div className="min-h-0 flex-1">
      <AgentChatContext.Provider value={agentChat}>
      <Chat
        session={selectedSession}
        streamingBlock={
          selectedSessionId ? streamingContentBlock[selectedSessionId] ?? null : null
        }
        onOpenSession={(id) => void handleSelectSessionIndexItem(id)}
        onRespondPermission={handleRespondPermission}
        onAnswerQuestions={handleAnswerQuestions}
        onCancelQuestion={handleCancelQuestion}
        busy={busy}
        backgroundTaskCount={backgroundTasks.length}
        liveTaskIds={liveTaskIds}
        compacting={compacting}
        apiRetry={apiRetry}
        queuedMessages={queuedMessages}
        onSendNow={handleSendNow}
        onLoadOlder={loadOlderEvents}
        working={working}
        crowded={!collapsed}
        active={chatShown}
      />
      </AgentChatContext.Provider>
      </div>
      {singleDrop && <DropZone region={singleDrop.region} label={singleDrop.label} />}
      </div>
      )}
      </TabBody>
      </div>
      </div>
      </RenderErrorBoundary>
      {callAgentId && roster.agents.find((a) => a.id === callAgentId) && (
        <CallScreen
          agent={roster.agents.find((a) => a.id === callAgentId)!}
          onEnd={(sum) => {
            setCallAgentId(null);
            toast(`Call ended · ${Math.floor(sum.seconds / 60)}:${String(sum.seconds % 60).padStart(2, "0")}`);
          }}
        />
      )}
      {/* Inside the column, so it covers the header, the transcript and the composer and nothing else. */}
      <ThreadView />
    </AppShell>
    {/* Outside `AppShell` on purpose: it is fixed to the window rather than
        placed in the layout, and the shell has no slot that isn't a pane. */}
    <ChatSheets
      sessionId={selectedSessionId}
      busy={busy}
      onStop={handleInterrupt}
      onRespond={handleRespondPermission}
    />
    <NoticeStack
      onSelect={(id) => goToSession(() => void handleSelectSessionIndexItem(id))}
      // The session and the pane both, since the card is about something the
      // transcript does not show. The pick is written the same way
      // `usePullRequest`'s `onOpened` writes it — `activeTab` honours a
      // standing pick, and opening the pane stores "changes" on its own.
      onOpenPr={() => openPrs()}
      onDeleteWorktree={(id) => removeWorktree(id)}
    />
    <SlowRequestToast />
    {paletteOpen && (
    <Suspense fallback={null}>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={(open) => {
          setPaletteOpen(open);
        }}
        items={paletteItems}
        loading={paletteSources.loading}
        onCreateAgent={(name) => {
          setNewAgentName(name);
          setNewAgentOpen(true);
        }}
      />
    </Suspense>
    )}
    <DragGhost />
    <QuitDialog />
    <LinkDialog />
    <WindowControls />
    {/* Mounted here rather than in the sidebar, which unmounts whole when it
        collapses and would take ⌘, with it. */}
    {settingsOpen && (
    <Suspense fallback={null}>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(next) => {
          setSettingsOpen(next);
          if (!next) setSettingsTab("profile");
        }}
        initialTab={settingsTab}
        updateStatus={updateStatus}
        updateManual={updateManual}
        updateBlocked={anyRunning}
        onCheckUpdates={checkForUpdates}
        onInstallUpdate={installUpdate}
        updateChannel={updateChannel}
        onUpdateChannelChange={setUpdateChannel}
        onOpenAgentAccess={(id) => {
          setSettingsOpen(false);
          setSettingsTab("profile");
          openProfile(id, "access");
        }}
        onOpenAgentMemory={(id) => {
          setSettingsOpen(false);
          setSettingsTab("profile");
          openProfile(id, "memory");
        }}
      />
    </Suspense>
    )}
    <NewAgentDialog
      open={newAgentOpen}
      editing={null}
      presetName={newAgentName}
      projects={projects}
      defaultProjectPath={projectPath}
      onPickFolder={pickProjectFolder}
      onClose={() => {
        setNewAgentOpen(false);
        setNewAgentName("");
      }}
      onSubmit={createAgent}
    />
    <NewAgentDialog
      open={settingsAgentId !== null}
      editing={settingsAgentId}
      projects={projects}
      defaultProjectPath={projectPath}
      onPickFolder={pickProjectFolder}
      onClose={() => setSettingsAgentId(null)}
      onSubmit={saveAgentSettings}
    />
    {editAgent && (
      <EditAgentDialog
        agent={editAgent}
        open
        onOpenChange={(o) => !o && setEditAgentId(null)}
        onChange={changeProfileAgent}
        onLook={() => {
          setEditAgentId(null);
          setSettingsAgentId(editAgent.id);
        }}
        onRoutines={() => {
          setEditAgentId(null);
          setPage("routines");
        }}
      />
    )}
    <NewChannelDialog
      open={channelDialog !== null}
      editing={channelDialog?.editing ?? null}
      agents={workspaceAgents}
      channels={channels}
      workspaceId={activeWs?.id ?? null}
      onClose={() => setChannelDialog(null)}
      onSaved={(c, created) => {
        setChannelDialog(null);
        openChannel(c.id);
        toast(created ? `#${c.name} is open. @mention someone to start.` : "Saved", { icon: <Hash /> });
      }}
    />
    <WorktreeDialog
      prompt={worktreePrompt}
      onConfirm={(sessionId) => removeWorktree(sessionId)}
      onClose={() => setWorktreePrompt(null)}
    />
    </DiffWorkerPool>
    </TooltipProvider>
  );
}

export default App;
