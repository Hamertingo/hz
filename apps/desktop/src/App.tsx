import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import "./App.css";
import Chat from "@/components/Chat";
import ChangesView from "@/components/changes/ChangesView";
import SecondOpinionAction from "@/components/changes/SecondOpinionAction";
import FilesView from "@/components/files/FilesView";
import ChatInput from "@/components/ChatInput";
import DiffWorkerPool from "@/components/DiffWorkerPool";
import DocsPanel from "@/components/DocsPanel";
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
import InboxTabs, { type InboxPage } from "@/components/InboxTabs";
import { prefetchPrList } from "@/hooks/usePrList";
import type { RunRow } from "@/hooks/useWorkflowRuns";
import { useInbox } from "@/hooks/useInbox";
import IssuePanel from "@/components/IssuePanel";
import { prKey, type PrRow } from "@/hooks/usePrList";
import PrPanel from "@/components/PrPanel";
import BrowserPane from "@/components/browser/BrowserPane";
import {
  clearOpenError,
  closeTab,
  describePick,
  openInBrowser,
  setPendingTab,
  setPickHandler,
  useBrowserTabs,
  usePendingTab,
} from "@/lib/browser";
import { setLinkOpener } from "@/lib/openLink";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePrMarks } from "@/hooks/usePrMarks";
import { usePrReady } from "@/hooks/usePrReady";
import { useWorkStatus } from "@/hooks/useWorkStatus";
import HandoffRow from "@/components/composer/HandoffRow";
import FollowupStrip from "@/components/composer/FollowupStrip";
import { trackFeature } from "@/lib/analytics";
import { handoffActions } from "@/lib/handoff";
import { prTabVisible, usePullRequest } from "@/hooks/usePullRequest";
import RightPanel, {
  PanelToggle,
  TabBody,
  tabOrder,
  type PanelTab,
} from "@/components/RightPanel";
import { useChatColumnFloor } from "@/components/ResizeHandle";
import Sidebar, {
  SidebarToggle,
  sessionUnits,
  sortSessions,
} from "@/components/Sidebar";
import SplitView, { DragGhost, DropZone } from "@/components/SplitView";
import SubagentChat from "@/components/SubagentChat";
import TodoPanel from "@/components/TodoPanel";
import PendingAskPanel from "@/components/chat/PendingAskPanel";
import { DROP_ATTR, useSessionDrag, type DropTarget } from "@/lib/dragSession";
import { contentRows } from "@/lib/palette";
import type { PaletteItem } from "@/lib/palette";
import { recalledPrompts } from "@/lib/recall";
import type { ShortcutId } from "@/lib/shortcuts";
import { displayPath } from "@/lib/space";
import {
  closePane,
  dropLabel,
  EMPTY_VIEW,
  GROUPS_KEY,
  groupName,
  members,
  groupOf,
  openBeside,
  paneOrder,
  pruneGroups,
  type SplitGroup,
} from "@/lib/groups";
import ComposerToolbar from "@/components/composer/ComposerToolbar";
import ContextMeter from "@/components/composer/ContextMeter";
import PermissionSelector, {
  offersPermissionModes,
} from "@/components/composer/PermissionSelector";
import DictateControl from "@/components/composer/DictateControl";
import AppShell from "@/components/layout/AppShell";
import SessionHeader from "@/components/layout/SessionHeader";
import BloubAvatar from "@/components/BloubAvatar";
import { nextEffort } from "@/components/composer/ModelSelector";
import { cycledModels, rowModel } from "@/lib/modelVisibility";
import { TooltipProvider } from "@/components/ui/tooltip";
import { pickAttachments } from "@/hooks/useAttachments";
import { useCodeTheme } from "@/hooks/useCodeTheme";
import { refreshActiveDoc, saveActiveDoc, useDocs } from "@/hooks/useDocs";
import { closeFile, openInFiles, useOpenFiles } from "@/hooks/useOpenFiles";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useGlass } from "@/hooks/useGlass";
import { warmHighlighter } from "@/hooks/useHighlighter";
import { useHotkey } from "@/hooks/useHotkey";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { dismissNotice, getNotices, pushNotice } from "@/hooks/useNotices";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useSessionIssues } from "@/hooks/useIssues";
import { useSessions } from "@/hooks/useSessions";
import { useSubagentWork } from "@/hooks/useSubagentWork";
import { useAgentAvailability, useMissingAgent } from "@/hooks/useAgentAvailability";
import AgentMissingNotice from "@/components/composer/AgentMissingNotice";
import LoginExpiredNotice from "@/components/composer/LoginExpiredNotice";
import type {
  AgentEvent,
  ContentMatches,
  Issue,
  SessionIndexItem,
  TranscriptMatch,
  WorktreeDisposition,
} from "@/types/events";
import { useRecorder } from "@/hooks/useTranscription";
import { useUpdater } from "@/hooks/useUpdater";
import { appendToDraft } from "@/hooks/useDraft";
import { issueTag } from "@/lib/issue";
import { usePreference } from "@/lib/prefs";
import { authFailedTurn } from "@/lib/auth";
import { basename } from "@/lib/format";
import { focusComposer } from "@/lib/composerFocus";
import { changeRange, turnChangedTree } from "@/lib/changes";
import { agentPickOf, hasPick, mcpPickOf, pickedSkillOf, sectionTab, type PluginsTab } from "@/lib/plugins";
import { prBadgeCount, sessionBranch } from "@/lib/pr";
import { playCelebration } from "@/lib/sound";
import {
  activeSpace,
  allowedInSpace,
  inSpace,
  moveSpace,
  sessionInSpace,
  spaceNames,
  SPACE_KEY,
  SPACE_LIST_KEY,
} from "@/lib/space";
import { worktreeNoticeDetail } from "@/lib/worktree";
import { buildTranscript } from "@/lib/transcript";
import { isActive, memberIdOf, memberTitle, runBrief, statusWord } from "@/lib/subagent";
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

const PANE_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

// Surfaces that only exist while the reader is acting on them — a dialog, the
// palette, a main-column page — load on first open instead of parsing at
// startup. Everything on the first-paint path stays static. A module's named
// exports ride the same chunk as its default, so opening one page pulls one
// file; they are separately `lazy` so each call site can suspend alone.
const CommandPalette = lazy(() => import("@/components/CommandPalette"));
const SettingsDialog = lazy(() => import("@/components/SettingsDialog"));
const SearchView = lazy(() => import("@/components/SearchView"));
const PrsView = lazy(() => import("@/components/PrsView"));
const PrDetail = lazy(() =>
  import("@/components/PrsView").then((m) => ({ default: m.PrDetail })),
);
const PrTabs = lazy(() =>
  import("@/components/PrsView").then((m) => ({ default: m.PrTabs })),
);
const IssuesView = lazy(() => import("@/components/IssuesView"));
const InboxView = lazy(() => import("@/components/InboxView"));
const PluginsView = lazy(() => import("@/components/PluginsView"));
const PluginSkillDetail = lazy(() =>
  import("@/components/PluginsView").then((m) => ({ default: m.SkillDetail })),
);
const RunDetail = lazy(() => import("@/components/RunDetail"));
const AgentForm = lazy(() => import("@/components/plugins/AgentForm"));
const McpForm = lazy(() => import("@/components/plugins/McpForm"));

/// The events of no session, for the composer's context panel while there is
/// none. Module-level rather than a fresh `[]` per render: it is a prop, and a
/// new array each time would be a new prop identity on every event.
const EMPTY_EVENTS: AgentEvent[] = [];

/// The main-column pages, and the one value that says which is up.
///
/// **The set, so `none` is spelled once and every page is spelled once.** Reading
/// a page off this is what stops a question about pages being answered by a list
/// written out again at each site — see the state's own note.
type MainPage = "none" | "inbox" | "issues" | "prs" | "plugins" | "search";

/// The one stop there is for delegated work, and it sits in the window header
/// because the composer's own Stop is under a subagent view's feet — that view
/// has no composer.
///
/// **"All" rather than the number**, and a count is deliberately absent: mcode
/// publishes no per-task handle, so the request ends every run the session
/// delegated. Naming one here would be a lie about the blast radius. The agent's
/// own refusal is drawn beside the button rather than in the composer, which
/// belongs to a session this view is not about.
function StopDelegations({
  sessionId,
  onStop,
}: {
  sessionId: string;
  onStop: (sessionId: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error && (
        <span className="max-w-48 shrink-0 truncate text-xs text-destructive">{error}</span>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        className="shrink-0 cursor-pointer"
        onClick={async () => {
          setBusy(true);
          setError(null);
          setError(await onStop(sessionId));
          setBusy(false);
        }}
      >
        Stop all
      </Button>
    </>
  );
}

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
    models,
    refreshModels,
    loadingModels,
    harness,
    modelId,
    effort,
    fast,
    setFast,
    fastNote,
    permissionMode,
    agentName,
    setAgentName,
    projects,
    projectPath,
    repos,
    repoPath,
    setRepoPath,
    atWorkspaceRoot,
    targetPath,
    branches,
    branch,
    useWorktree,
    busy,
    backgroundTasks,
    liveTaskIds,
    delegations,
    delegationsBySession,
    refreshDelegations,
    stopDelegations,
    compacting,
    apiRetry,
    working,
    contextUsage,
    error,
    setError,
    handleModelChange,
    setPermissionMode,
    handleAttachProject,
    handleSelectProject,
    handleRemoveProject,
    setProjectSpace,
    retagSpace,
    canAnnounce,
    handleSelectBranch,
    pendingBranch,
    setPendingBranch,
    runCheckout,
    setUseWorktree,
    handleSendMsg,
    startSecondOpinion,
    handleInterrupt,
    handleSendNow,
    queuedMessages,
    pendingAsks,
    handleCancelQueued,
    handleRespondPermission,
    handleAnswerQuestions,
    handleCancelQuestion,
    handleSelectSessionIndexItem,
    handleNewSession,
    setSessionFlags,
    forkSession,
    unlinkIssue,
    detachSession,
    deleteSession,
    removeWorktree,
    ensureLoaded,
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
  // The wider scope the filter sits inside: a space is a tag on a project, so
  // this narrows the project list itself and everything reading it follows.
  // A durable preference under the key `announce` reads, since notifications
  // answer to the same scope and there is only one right answer to which space
  // is up — see `src/lib/prefs.ts`.
  const [storedSpace, setStoredSpace] = usePreference(SPACE_KEY, null);
  // Spaces the reader has made but not yet filled. Membership is the tag on the
  // project, so this list only has to carry the ones no project names yet —
  // `spaceNames` reads the two as one set.
  const [declaredSpaces, setDeclaredSpaces] = usePreference(SPACE_LIST_KEY, []);

  const spaces = useMemo(
    () => spaceNames(projects, declaredSpaces),
    [projects, declaredSpaces],
  );
  // Derived rather than corrected in place: a space that was removed takes its
  // stored name with it, and rewriting that from a render would be a write
  // nobody asked for.
  const space = activeSpace(projects, storedSpace, declaredSpaces);
  const spaceProjects = useMemo(() => inSpace(projects, space), [projects, space]);
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

  /// The subagent whose conversation the main column is showing, if any.
  ///
  /// Holds the pair rather than the child's id alone, because the read takes
  /// both: a roster belongs to the session that delegated it, and that session is
  /// still the selected one behind this view — its header, its right panel and
  /// its marks are all one click back.
  const [subagentView, setSubagentView] = useState<{
    sessionId: string;
    memberSessionId: string;
  } | null>(null);

  /// Where ⌘[ and ⌘] walk. Held here rather than in a store because it dies with
  /// the window and nothing else reads it — see [tabVisitHistory](lib/tabVisitHistory.ts).
  const [visits, setVisits] = useState<VisitHistory>(EMPTY_VISITS);
  /// Set while a step is being taken, so the recording effect below does not
  /// push the session the step just moved to — which would erase the forward
  /// trail the step was walking.
  const steppingVisit = useRef(false);

  /// Bumped by an undo, which is the one thing that moves the working tree with
  /// no event behind it — see `revision`.
  const [repoRevision, setRepoRevision] = useState(0);

  /// A review is being opened. Held here rather than in the hook because it is
  /// about the control: opening one is a worktree and a cold child, and a second
  /// press inside that window would open a second session.
  const [secondOpinionBusy, setSecondOpinionBusy] = useState(false);

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
  const issuesOpen = page === "issues";
  const searchPageOpen = page === "search";
  const prsOpen = page === "prs";
  const pluginsOpen = page === "plugins";

  /// Pages are lazy chunks, so a page mounts on its first open and then stays
  /// mounted — the same hidden-not-unmounted bargain its `TabBody` makes.
  /// Before the first open there is no state to keep, so not mounting it is
  /// the same behavior at none of the parse cost.
  const [seenPages, setSeenPages] = useState<MainPage[]>([]);
  useEffect(() => {
    if (page !== "none") setSeenPages((prev) => (prev.includes(page) ? prev : [...prev, page]));
  }, [page]);
  const pageSeen = (p: MainPage) => seenPages.includes(p);
  /// What the Plugins page is listing, and what its pane is showing with it.
  ///
  /// **One value for both**, because the pane draws the thing its own section
  /// lists — so a Skill held in one place and a section in another is a pane
  /// describing something that is not on the page. `pickedSkillOf`, `mcpPickOf` and
  /// `hasPick` are the only questions asked of it.
  const [pluginsTab, setPluginsTab] = useState<PluginsTab>(() => sectionTab("skills"));
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

  /// The two reads the inbox is made of, started here rather than on arrival.
  ///
  /// **The shell owns them because the counts on the source row do.** That row is
  /// drawn by three surfaces, and a number read in three places is three answers
  /// — so `App` reads both halves once and hands the same rows and the same
  /// numbers to whichever of the three is up.
  const inbox = useInbox(prsCwds);

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
  /// showing — the same split the issues page makes, and the reason `pickedIssue`
  /// lives here too.
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
  const [pickedRun, setPickedRun] = useState<RunRow | null>(null);

  /// The tab on screen, or `null` where the pane is empty. Derived rather than
  /// held, so a key that no longer names an open tab can never be selected.
  const activePr = openedPrs.find((pr) => prKey(pr) === activePrKey) ?? null;

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
  /// The page's own refresh, so ⌘R and a write made in the pane beside it can
  /// reach the listing. A ref rather than state, for `issuesRefreshRef`'s reason:
  /// the page owns the read and re-rendering the app per keystroke in its search
  /// box would be a render per keystroke.
  const prsRefreshRef = useRef<(() => void) | null>(null);

  /// The issues page's own refresh, so ⌘R can reach it. A ref rather than
  /// state: the page owns the read and hands its handle up, and re-rendering
  /// the whole app every time that handle is re-made would be a render per
  /// keystroke in the page's search box.
  const issuesRefreshRef = useRef<(() => void) | null>(null);

  /// The plugins page's own refresh, so ⌘R can reach it. A ref for the reason the
  /// two above are: the page owns the read — which here can cost the agent child's
  /// first boot — and hands its handle up rather than being re-rendered to receive
  /// one.
  const pluginsRefreshRef = useRef<(() => void) | null>(null);

  /// The issue the pane is showing while the issues page has the column.
  ///
  /// Kept as the whole row rather than an identifier: the list already read
  /// every field a header draws, so the pane can be complete before its own
  /// detail read lands — the same bargain the session panel makes with a
  /// session's links.
  const [pickedIssue, setPickedIssue] = useState<Issue | null>(null);

  /// The picked issue as a link, which is the shape the panel reads.
  ///
  /// Memoized because it is an array: a fresh one each render would re-run the
  /// detail read on every keystroke in the page's search box.
  const pickedIssueRefs = useMemo(
    () =>
      pickedIssue
        ? [
            {
              tracker: pickedIssue.tracker,
              id: pickedIssue.id,
              identifier: pickedIssue.identifier,
              title: pickedIssue.title,
              url: pickedIssue.url,
            },
          ]
        : [],
    [pickedIssue],
  );

  const pickedIssueData = useSessionIssues(pickedIssueRefs, issuesOpen && !!pickedIssue);

  // Owned here rather than by any one surface: the settings row, the issues
  // page's own connect form and the composer's placeholder all read it, and a
  // hook per surface is a second answer to "are we connected" free to disagree
  // with the first.
  const integrations = useIntegrations(true);
  const issuesConnected = !!integrations.integrations?.linear;

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
  const [paletteQuery, setPaletteQuery] = useState("");
  const [messageHits, setMessageHits] = useState<TranscriptMatch[]>([]);
  /// Which search is allowed to write. A keystroke issues a walk over every log,
  /// and an answer to the *previous* query landing after this one would file its
  /// rows against words the reader has since changed.
  const searchGen = useRef(0);

  useEffect(() => {
    const query = paletteQuery.trim();
    // Two characters before any read: one letter matches most of a life's work
    // and costs the whole walk to say so.
    if (!paletteOpen || query.length < 2) {
      searchGen.current += 1;
      setMessageHits([]);
      return;
    }

    const gen = ++searchGen.current;
    const timer = setTimeout(() => {
      void invoke<TranscriptMatch[]>("search_transcripts", { query })
        .then((found) => {
          if (searchGen.current === gen) setMessageHits(found);
        })
        .catch(() => {
          // A search that could not run is a search with no results, never an
          // error over the list: the palette still reaches everything else, and
          // a sentence about the failure would be between the reader and that.
          if (searchGen.current === gen) setMessageHits([]);
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [paletteQuery, paletteOpen]);

  // The same box searches the *files* the session runs in, for the same reason it
  // searches the logs: what a reader remembers is a line they saw, and the file it
  // is in is the one they have not opened. Scoped to the selected session, because
  // a hit opens in *that* session's file view — a hit with no session to open into
  // would be a row that looks like a place to go and is not.
  const contentGen = useRef(0);
  const [contentHits, setContentHits] = useState<ContentMatches | null>(null);
  const contentCwd = selectedSession?.cwd ?? null;

  useEffect(() => {
    if (!paletteOpen || paletteQuery.length < 2 || !contentCwd) {
      contentGen.current += 1;
      setContentHits(null);
      return;
    }

    const gen = ++contentGen.current;
    const timer = setTimeout(() => {
      void invoke<ContentMatches>("search_content", { cwd: contentCwd, query: paletteQuery })
        .then((found) => {
          if (contentGen.current === gen) setContentHits(found);
        })
        .catch(() => {
          // The bargain the transcript search makes: a read that could not run is
          // no results, never an error between the reader and the rows that worked.
          if (contentGen.current === gen) setContentHits(null);
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [paletteQuery, paletteOpen, contentCwd]);

  // Which tab the *next* open lands on. Reset to Appearance as settings close,
  // so a mic press that sent the reader to Transcription does not leave every
  // later ⌘, opening there too.
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");

  /// Opens Settings on the providers — where a reader whose model picker came up
  /// empty can actually do something about it. The section is set before the
  /// surface opens, so it draws on the right one rather than switching under the
  /// reader's eyes.
  const openProviderSettings = () => {
    setSettingsTab("providers");
    setSettingsOpen(true);
  };
  // Whether that open should land with the new-space field already up. Same
  // reset as the tab, and for the same reason: it describes the way in, not the
  // dialog.
  const [namingSpace, setNamingSpace] = useState(false);

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
      setSettingsTab("transcription");
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

    // The disposition read above is an `await`, so this card can arrive in a
    // space the reader has moved to since settling the session — and it names
    // the session's own title. The dialog route above is deliberately not
    // guarded: the reader pressed a button and is owed its answer.
    if (!canAnnounce(sessionId)) return;

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
  // session's log that reads both halves of it, the list a call carries in its
  // input and the one a result answers with. Nothing here knows which harness
  // sent it; see [todoTimeline](lib/todo.ts).
  const { subagents, resultByCallId, events: mainEvents, todoPlan } = useMemo(
    // Same `busy` and task set the chat passes. Left off, a subagent's
    // in-flight call would show in the panel as one that never finished.
    () => buildTranscript(selectedSession?.events ?? [], busy, liveTaskIds),
    [selectedSession?.events, busy, liveTaskIds],
  );

  // The strip is **this turn's** work: runs the agent is holding, and runs that
  // reported before the turn closed — dropping one the moment it lands reads as
  // the strip swallowing its own news. The next prompt retires them, since
  // whatever the agent was mid-way through, this turn is not going to finish it.
  //
  // Background work is deliberately absent. A dev server outlives every turn by
  // design, so holding this band for it would keep the handoff peek away for the
  // rest of the session. It already has a home: the transcript's own background
  // notice, which says how many are outstanding wherever the reader is scrolled.
  const liveRuns = useMemo(() => {
    if (!busy) return [];
    let lastPrompt = -1;
    for (let i = mainEvents.length - 1; i >= 0; i--) {
      if (mainEvents[i].payload.type === "user_message") {
        lastPrompt = i;
        break;
      }
    }
    return subagents.filter((r) => {
      if (!r.done) return true;
      const spawn = r.spawn;
      if (!spawn) return true;
      return mainEvents.findIndex((e) => e.id === spawn.id) > lastPrompt;
    });
  }, [subagents, busy, mainEvents]);

  // The plan rides the turn. Its whole value here is "which step is the agent on
  // *now*", and a finished plan left standing would hold the strip up for the
  // rest of the session — a permanent band above the composer for work that
  // ended an hour ago, with the handoff peek locked out of it. So the strip
  // drops it with the turn and the panel's Plan tab keeps it: a tab costs
  // nothing idle, and the peek is the only way to Commit at all.
  const stripPlan = busy ? todoPlan : null;
  const stripShown = liveRuns.length > 0 || stripPlan !== null;

  // ── The open subagent ─────────────────────────────────────────────────────
  //
  // Three accounts of one child meet here, and none can be derived from another.
  // The roster says what it is and whether it is still going. The spawning call —
  // the row the reader clicked in the transcript — says what it was asked to do.
  // The child's own session is the work itself, read while it runs.
  //
  // A run the roster no longer holds is drawn from the log alone, which is every
  // run in a transcript replayed after a restart: a roster is live-only and
  // unpersisted, so there is nothing left to read and the brief is the whole of
  // what that case can show.
  const openSubagentMember = subagentView
    ? (delegationsBySession[subagentView.sessionId] ?? []).find(
        (member) => member.sessionId === subagentView.memberSessionId,
      ) ?? null
    : null;

  const openSubagentFallback =
    subagentView && !openSubagentMember
      ? subagents.find((run) => run.id === subagentView.memberSessionId) ?? null
      : null;

  const openSubagentLive = openSubagentMember !== null && isActive(openSubagentMember);

  // One child, one poll. Nothing is asked when the view names a run rather than a
  // member — there is no child session behind it to read.
  const { messagesFor } = useSubagentWork(
    openSubagentMember && subagentView ? subagentView.sessionId : null,
    openSubagentMember ? [openSubagentMember.sessionId] : [],
    openSubagentLive,
  );

  const openSubagentEvents = openSubagentMember
    ? messagesFor(openSubagentMember.sessionId)
    : [];

  // In the order the two accounts fall: the roster's where it holds a row, the
  // log's otherwise. `status` is null for a run, which is what tells the view to
  // draw no status word rather than one it invented.
  const openSubagentTitle = openSubagentMember
    ? memberTitle(openSubagentMember)
    : (openSubagentFallback?.status ??
      openSubagentFallback?.description ??
      openSubagentFallback?.label ??
      "Subagent");
  const openSubagentAgent = openSubagentMember
    ? openSubagentMember.agentName
    : openSubagentFallback?.label ?? null;
  const openSubagentStatus = openSubagentMember ? openSubagentMember.status : null;
  const openSubagentBrief = openSubagentFallback ? runBrief(openSubagentFallback) : null;

  // What the composer's handoff row draws itself from, and — one line down —
  // which branch the pull requests are looked up by. Read on the same falling
  // edge as those, since a turn is what moves all of it.
  const { status: workStatus } = useWorkStatus(selectedSession?.cwd ?? "", busy);

  // Filtered here rather than inside the sidebar, so the list and the ⌘⇧↑/↓ walk
  // read one array. `projectPath` on the item is the repo root, so a worktree
  // session stays under the project it forked from.
  // The space is the outer scope and the filter the inner one, both applied
  // here: this list is what the sidebar draws, what the chords walk and what
  // the PR marks and the ready notice are read from, so narrowing it once is
  // the whole of "another space is running, out of sight".
  const visibleSessions = useMemo(
    () =>
      sessionIndexItems.filter(
        (i) =>
          sessionInSpace(projects, space, i.projectPath) &&
          (!projectFilter || i.projectPath === projectFilter),
      ),
    [sessionIndexItems, projects, space, projectFilter],
  );

  // Split groups: frontend-only, filed under the space they were made in. A
  // member whose project has since left the space is not drawn, and a group
  // that leaves fewer than two is no group here. Not narrowed by the project
  // filter — the grid shows the whole group, and the sidebar's run narrows
  // itself to the rows it draws.
  const [groups, setGroups] = useLocalStorage<SplitGroup[]>(GROUPS_KEY, []);
  const spaceGroups = useMemo(() => {
    const shown = new Set(
      sessionIndexItems
        .filter((i) => sessionInSpace(projects, space, i.projectPath))
        .map((i) => i.sessionId),
    );
    return groups
      .filter((g) => g.space === space)
      .map((g) => ({
        ...g,
        columns: g.columns.map((c) => c.filter((id) => shown.has(id))).filter((c) => c.length),
      }))
      .filter((g) => members(g).length >= 2);
  }, [groups, space, projects, sessionIndexItems]);

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
  // The open flag alone is keyed by the *group* while the session sits in one.
  // The pane stands beside the whole grid, and the selected session is
  // whichever pane has focus, so a per-session flag snapped it open and shut
  // as focus moved between panes. Open is a question about the column's
  // layout; the tab is a question about the focused session's content, and
  // so stays with the session. The two keys hand state across: a group
  // forming takes the focused session's flag, and every write lands on both,
  // so a group dissolving leaves each session holding the last state it saw.
  //
  // The pick's `null` is "never picked", and it is the whole of the default-tab
  // rule: seeding `"changes"` would make a fresh session indistinguishable from
  // one where the reader chose Changes, so an open PR could never lead — see
  // `activeTab`.
  const [panelOpens, setPanelOpens] = useState<Record<string, boolean>>({});
  const [panelTabs, setPanelTabs] = useState<Record<string, PanelTab | null>>({});
  /// Whether the pane has taken the column, over the transcript.
  ///
  /// **App-wide, unlike the two above, and that is the whole point of it.**
  /// Open and tab are per session because they are about a session's content —
  /// a pane opened on one session's PR was blank beside the next. This is about
  /// how the reader is looking at something: it is the answer to a diff that
  /// does not fit, and switching sessions to glance at another does not ask for
  /// the room back. Not persisted, for `panelOpen`'s reason.
  const [panelExpanded, setPanelExpanded] = useState(false);
  const openKey = useCallback(
    (id: string) => {
      const group = groupOf(spaceGroups, id);
      return group ? `group:${group.id}` : id;
    },
    [spaceGroups],
  );
  const panelOpen = selectedSessionId
    ? (panelOpens[openKey(selectedSessionId)] ?? panelOpens[selectedSessionId] ?? false)
    : false;
  useEffect(() => {
    if (!activeGroup || !selectedSessionId) return;
    const key = `group:${activeGroup.id}`;
    setPanelOpens((prev) =>
      key in prev ? prev : { ...prev, [key]: prev[selectedSessionId] ?? false },
    );
  }, [activeGroup, selectedSessionId]);
  const panelTab = selectedSessionId ? (panelTabs[selectedSessionId] ?? null) : null;
  // Both take the session because one caller opens a session and its pane in
  // the same breath, before the selection has moved.
  const setPanelOpen = useCallback(
    (open: boolean | ((prev: boolean) => boolean), id = selectedSessionId) => {
      if (!id) return;
      const key = openKey(id);
      setPanelOpens((prev) => {
        const next = typeof open === "function" ? open(prev[key] ?? prev[id] ?? false) : open;
        return { ...prev, [key]: next, [id]: next };
      });
    },
    [selectedSessionId, openKey],
  );
  const setPanelTab = useCallback(
    (tab: PanelTab | null, id = selectedSessionId) => {
      if (id) setPanelTabs((prev) => ({ ...prev, [id]: tab }));
    },
    [selectedSessionId],
  );
  /// Brings the pane up on a tab. The one action every route to a view needs,
  /// since the pane may be closed — and a tab set on a hidden pane is a change
  /// nobody sees.
  const showPanelTab = useCallback(
    (tab: PanelTab) => {
      setPanelTab(tab);
      setPanelOpen(true);
    },
    [setPanelTab, setPanelOpen],
  );

  /// Whether one of the main-column pages is up.
  ///
  /// A page fills the column the session's own views live in — Chat, Diff,
  /// Browser, Files — so every one of those asks *this* and not a named page.
  /// Read off the one value the pages are held in, so it cannot be a list that
  /// was written out again and came up short: it was, and the composer drew under
  /// a page for it.
  const pageOpen = page !== "none";

  /// Whether the right pane is actually on screen, as against whether the
  /// reader has asked for it.
  ///
  /// Two different questions, and conflating them was a bug worth naming: a
  /// page fills the main column, so a pane left open beside it went on
  /// describing the session the reader had *left* — its changes, its pull
  /// request, its issue — with nothing on screen to say whose they were. The
  /// preference is kept, so coming back restores the pane exactly as it was;
  /// everything that draws or reads reads this instead.
  const panelShown = panelOpen && !pageOpen;
  /// The pane is up *and* holding the column. `panelShown` alone is not enough:
  /// a page takes the column for itself, and a pane left expanded behind one
  /// would come back over the page it was hidden by.
  const panelWide = panelExpanded && panelShown;
  /// The transcript is actually on screen: no page over it, and not behind the
  /// pane at its wide size. What `Chat` and `SplitView` take as `active`, which
  /// is a question about being *seen* — a hidden transcript must not follow the
  /// stream or claim the chords that scroll it.
  const chatShown = !pageOpen && !panelWide;
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

  // The dropped session is the one just opened, so it takes the focus. Only
  // on a drop that opens something: selecting after a refused one would swap
  // the grid for that session's single view.
  const dropSession = ({ sessionId: anchor, region }: DropTarget, dropped: string) => {
    if (!dropLabel(spaceGroups, anchor, dropped, region)) return;
    // Nothing open, so the drop is the click: the session opens whole.
    if (anchor !== EMPTY_VIEW) setGroups((prev) => openBeside(prev, anchor, dropped, region, space));
    void handleSelectSessionIndexItem(dropped);
  };

  const closeSessionPane = (sessionId: string) => {
    setGroups((prev) => closePane(prev, sessionId));
    if (sessionId !== selectedSessionId || !activeGroup) return;
    const next = members(activeGroup).find((id) => id !== sessionId);
    if (next) void handleSelectSessionIndexItem(next);
  };

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

  // "This can land now" — raised off the sidebar's marks rather than the
  // panel's own read, which is the only way it can be noticed at all: the
  // panel's poll is gated on its tab being on screen, and a tab on screen is
  // exactly the case with nothing to announce.
  usePrReady({ sessions: visibleSessions, prFor: prMarks.prFor });

  // Read here rather than inside the panel: the tab row needs to know whether
  // there is an open PR before that tab has ever been shown, so ordering it
  // first can't wait on the panel fetching for itself.
  //
  // `workStatus.branch` is git's own reading of HEAD and outranks the name the
  // index carries, which is only ever a guess made at creation — see
  // `sessionBranch`. It lands a frame late and the fallback covers that frame.
  const prBranch = selectedSession
    ? sessionBranch(selectedSession, workStatus?.branch)
    : null;
  // "The PR tab is on screen", read off the *pick* rather than off `activeTab`,
  // which cannot exist yet — it is derived from this hook's own answer. An
  // unset pick counts, since the derived default is the PR tab whenever there
  // is an open one. The one case the two disagree is a session whose only PRs
  // are merged: the pick is unset, the default resolves to Changes, and this
  // reads true — harmless, because a merged PR never settles and the poll is
  // gated on that too.
  const pullRequests = usePullRequest(
    selectedSession?.cwd ?? "",
    prBranch,
    panelShown && (panelTab === "pr" || panelTab === null),
    // A pull request appearing is the moment the session stops being about the
    // turn and starts being about landing, so the pane opens onto it rather
    // than waiting to be asked. Fires at most once per PR — see `onOpened`.
    //
    // It moves the pick as well as opening the pane, and has to: `activeTab`
    // honours a standing pick over the derived default, and the pick is written
    // by the app itself — `handleTogglePanel` stores "changes" every time the
    // pane is opened onto a turn that touched files. So opening alone landed on
    // Changes for anyone who had ever used ⌘E, which is everyone.
    // A fresh closure each render is fine: the hook holds it in a ref.
    () => {
      setPanelTab("pr");
      setPanelOpen(true);
    },
    // A merge or a reopen changes what the sidebar's mark should say, and that
    // mark comes from a different read with a two-minute freshness window — so
    // without this the row keeps its open-PR glyph until the window expires or
    // a turn ends.
    //
    // `refreshAfterWrite`, not `refresh`: the write can land after the reader
    // has filtered the mutated repo off screen, and a plain refresh only reads
    // what is visible then. See the hook.
    () => prMarks.refreshAfterWrite(),
  );
  // A draft counts: GitHub reports one as `OPEN` with `isDraft` set, and a
  // draft is still the point at which the work stops being about this turn.
  const openPrsHere = pullRequests.prs.filter((pr) => pr.state === "OPEN");
  const hasOpenPr = openPrsHere.length > 0;
  // Only where *every* open one is a draft. A session carrying a draft beside a
  // real PR has something asking to land, and the mark should say so.
  const allDrafts = hasOpenPr && openPrsHere.every((pr) => pr.isDraft);
  // The sidebar already knows whether this branch has a pull request, and the
  // panel's own read takes the better part of a second to agree — during which
  // `prs` is empty, the tab is not in the row, and a pane opened onto the PR tab
  // lands on Changes and jumps a beat later. So the mark stands in, but *only*
  // while that read is out: once it answers, the panel's own answer governs, so
  // this can never leave a tab drawn for a branch it found no PR on. The two
  // can disagree — the mark is looked up by the branch the index remembers and
  // the panel by the one git reports — and the window closes either way.
  const markHere = prMarks.prFor(selectedSession?.projectPath ?? "", prBranch);
  const hasPrTab =
    prTabVisible(pullRequests.prs, pullRequests.error) || (pullRequests.loading && !!markHere);

  // Where the pane lands with nothing picked. An open pull request wins over
  // anything the last turn did: changes describe one turn and are superseded by
  // the next, where a PR is the state of the work.
  const defaultTab: PanelTab = hasOpenPr && hasPrTab ? "pr" : "changes";

  // Read off the *pick*, not off `activeTab`, which is derived below from the
  // tab row this feeds. An unset pick does not count here, unlike the PR tab's:
  // the derived default is never the issue tab, so nothing is being read unless
  // the reader asked for it.
  const activeTabIsIssue = panelTab === "issue";

  // Straight off the index entry, which is where a link lives — so the tab is
  // there the moment a prompt tags one, with no read to wait on.
  const sessionIssues = selectedSession?.issues ?? [];
  const hasIssueTab = sessionIssues.length > 0;

  const issueData = useSessionIssues(sessionIssues, panelShown && activeTabIsIssue);

  // Read here rather than in the panel, for the PR tab's reason: the row has to
  // know whether the tab exists before that tab has ever been drawn.
  const { docs, activePath: activeDocPath, opened: docsOpened } = useDocs(selectedSessionId);
  // The counter brings the view forward; the active path is what ⌘W closes.
  // Which files are open past that is the view's own business, where a doc's
  // tab row has to exist in the panel before the panel is drawn.
  const { opened: filesOpened, active: activeFile } = useOpenFiles(selectedSessionId);
  const hasDocsTab = docs.length > 0;
  const activeDoc = docs.find((doc) => doc.path === activeDocPath) ?? null;

  const browserTabs = useBrowserTabs(selectedSessionId);
  const pendingBrowserTab = usePendingTab(selectedSessionId ?? "");
  const hasBrowserTabs = browserTabs && browserTabs.length > 0;

  // Read off the session's own log rather than off `busy`: a plan outlives the
  // turn that wrote it, and the tab is what the strip hands the finished one to.
  const hasTodoTab = todoPlan !== null;

  const tabs = tabOrder({
    pr: hasPrTab,
    docs: hasDocsTab,
    issue: hasIssueTab,
    todo: hasTodoTab,
  });

  // One rule, read rather than written back: an explicit pick wins wherever it
  // still names a tab this session draws, and otherwise the derived default
  // stands in. Not written back, so switching to a session without a PR keeps
  // the reader's pick for when they switch to one that has it.
  const activeTab: PanelTab = panelTab && tabs.includes(panelTab) ? panelTab : defaultTab;

  /// The browser is on screen. One reading, since the pane is its only home
  /// now — the layout and the chord that closes a tab both ask this.
  const browserShown = panelShown && activeTab === "browser";

  const togglePanel = () => setPanelOpen((prev) => !prev);

  /// Swaps the pane's two sizes, opening it on the way in — a reader asking for
  /// the room is asking to see the pane. Guarded on a session for the reason
  /// `setPanelOpen` is: with none there is no pane to size, and flipping the
  /// flag anyway would land it on whichever session is opened next.
  const togglePanelWide = () => {
    if (!selectedSessionId || pageOpen) return;
    setPanelOpen(true);
    setPanelExpanded((prev) => !prev);
  };

  // Moves along the visible row, wrapping. Off `tabs` rather than `PANEL_TABS`,
  // so a session with no PR tab cycles through two and never lands on one that
  // isn't drawn.
  const stepTab = (delta: number) => {
    if (!panelShown) return;
    const from = tabs.indexOf(activeTab);
    setPanelTab(tabs[(from + delta + tabs.length) % tabs.length]);
  };

  /// Opens one subagent's conversation in the main column.
  ///
  /// **The session stays selected.** A subagent is not a session — it has no
  /// index entry, no branch and no composer — so the view is read-only and the
  /// column keeps describing the session the work belongs to. Selecting the parent
  /// is what makes that true for a row clicked in *another* session's list, and
  /// it is why the roster is read again here: it is live-only, so opening a view
  /// is the moment it is asked for.
  const openSubagentView = (sessionId: string, memberSessionId: string) => {
    goToSession(() => {
      if (sessionId !== selectedSessionId) void handleSelectSessionIndexItem(sessionId);
    });
    setSubagentView({ sessionId, memberSessionId });
    void refreshDelegations(sessionId);
  };

  const closeSubagentView = () => setSubagentView(null);

  // The view belongs to the session under it. Anything that moves the selection
  // elsewhere — the sidebar, a chord, a fork, a notice — closes it, or the column
  // would go on drawing one session's subagent under another's header. Written as
  // one invariant rather than at each of those call sites, which is the same
  // reason `visibleSessions` states the space narrowing once.
  //
  // `selectedSessionId` is set synchronously by the select above, so a view
  // opened in the same batch is not cleared on the way in.
  useEffect(() => {
    if (subagentView && subagentView.sessionId !== selectedSessionId) setSubagentView(null);
  }, [subagentView, selectedSessionId]);

  /// The lit row in the sidebar, as one key. Built here so the row and the view
  /// cannot disagree about which subagent is open.
  const openSubagentKey = subagentView
    ? `${subagentView.sessionId}:${subagentView.memberSessionId}`
    : null;

  /// Opens the first subagent the session has, for the two controls that point at
  /// "the subagents" rather than at one of them — the background-tasks notice and
  /// the follow-up strip's overflow row. A running one wins, since that is the one
  /// worth looking at; an empty roster opens nothing and leaves the caller to draw
  /// no control at all.
  const openFirstSubagent = () => {
    const first = delegations.find(isActive) ?? delegations[0];
    if (selectedSessionId && first) openSubagentView(selectedSessionId, first.sessionId);
  };

  /// Whether the controls that point at "the subagents" have anything to open.
  /// Asks the roster and the runs rather than the task count: a background task
  /// is not a subagent, so a session can hold one with nothing to open.
  const canOpenSubagent = delegations.length > 0 || subagents.length > 0;

  /// Opens the run a transcript row names.
  ///
  /// Resolved through the roster where it can be, so the view is the child's own
  /// session; a run the roster no longer holds — every run in a transcript
  /// replayed after a restart — opens on the log's own account of it instead,
  /// which is the brief and nothing to read. Guessing at neither is the one
  /// answer that would open somebody else's work.
  const openSubagentRun = (runId: string) => {
    if (!selectedSessionId) return;
    const run = subagents.find((candidate) => candidate.id === runId);
    if (!run) return;

    const memberId = memberIdOf(run, delegations, resultByCallId.get(runId));
    openSubagentView(selectedSessionId, memberId ?? runId);
  };

  /// Opens the plan in the pane, for the rows the strip had no room for. Same
  /// bargain as the subagent view: the tab, not the selection.
  const openTodoPanel = () => showPanelTab("todo");

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
  // `true` wherever hz has no answer: the list may not have landed, and pi
  // picks its own model when none is named. A warning drawn on a guess is worse
  // than none, so absence reads as capable.
  const modelTakesImages =
    models.find((m) => m.id === modelId)?.acceptsImages ?? true;

  const { baseline, head } = useMemo(
    () => changeRange(selectedSession?.events ?? []),
    [selectedSession?.events],
  );

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
    pullRequests.refresh();
    prMarks.refresh();
  }, [selectedSessionId, busy, pullRequests.refresh, prMarks.refresh]);

  // A doc arriving on screen is re-read, because the watcher behind `DocsPanel`
  // only ever holds the *selected* session's files: anything written while the
  // reader was somewhere else was written unwatched. A turn ending needs no
  // rule of its own — the agent's write is exactly what the watcher sees.
  //
  // One value rather than three conditions: opening the tab, stepping to another
  // chip and switching session all put a different file in front of the reader,
  // and each wants the same read. A dirty draft is flagged rather than replaced,
  // so this cannot eat an edit, and a doc whose first read is still out is
  // skipped, which is what stops opening the tab reading the same file twice.
  const shownDoc =
    panelShown && activeTab === "docs" ? `${selectedSessionId}\n${activeDocPath}` : null;
  useEffect(() => {
    if (shownDoc) refreshActiveDoc(selectedSessionId);
  }, [shownDoc]);

  // From the sidebar's own per-repo read, not a fourth git call: once a pull
  // request exists the panel is where it is acted on, and a Create PR button
  // beside it would open a duplicate.
  //
  // An *open* one, and the check is explicit now that the marks carry merged
  // ones too: a branch whose PR has landed and is being worked on again wants
  // Create PR back. Nothing else usually offers it there — a merged branch is
  // level with its base, which `handoff` reads as nothing to open — but the two
  // answer different questions and folding them cost the button in the one case
  // it was wanted.
  const sessionHasPr = markHere?.state === "OPEN";

  // Read off the two tree ids rather than off the panel's file list: the panel
  // pauses its reads while hidden, which is exactly when the indicator has to
  // be right.
  const lastTurnChanged = turnChangedTree({ baseline, head });

  /// Closes what a page that owns the column has open, innermost first, and
  /// answers whether it handled the press.
  ///
  /// **One function because the chord and the button have to agree.** They were
  /// two copies of this rule once, and the copy in the chord went past the one
  /// in the button into a pane that was not on screen. Neither page can *open*
  /// its pane — a row is what picks the thing — so both halves only ever close,
  /// and closing the detail before the page is the same innermost-first order
  /// ⌘W takes.
  const closePagePane = () => {
    if (issuesOpen) {
      setPickedIssue(null);
      return true;
    }
    if (prsOpen) {
      if (activePrKey) closePr(activePrKey);
      else setPage("none");
      return true;
    }
    if (pluginsOpen) {
      // The detail first, then the page: innermost first, the order the two arms
      // above take.
      if (hasPick(pluginsTab)) setPluginsTab(sectionTab(pluginsTab.section));
      else setPage("none");
      return true;
    }
    return false;
  };

  // The click lands on whatever the glyph was drawing — a git icon that opened
  // the subagents tab would be a lie. That is all this does now: which tab the
  // pane *defaults* to is `activeTab`'s rule and needs no help here, and ⌘E
  // stays a plain toggle because it draws nothing and so promises nothing.
  const handleTogglePanel = () => {
    if (closePagePane()) return;
    if (!panelOpen) {
      if (hasOpenPr && hasPrTab) setPanelTab("pr");
      else if (lastTurnChanged) setPanelTab("changes");
    }
    togglePanel();
  };

  // What tells the panel to re-read — a cache key, not a count. The event total
  // moves as a turn's writes land, and `busy` covers the turn ending, where the
  // final file write and the closing event can arrive in either order.
  //
  // **An undo is the third term** and the reason this is not just those two: it
  // moves the working tree without an event, so nothing else would tell a view
  // its answer had gone stale.
  const revision = `${selectedSession?.events.length ?? 0}:${busy}:${repoRevision}`;

  // One button, so the tab decides what it re-reads. Diff has nothing to fetch
  // here: `ChangesView` owns its own reads and re-runs them off `revision` and
  // off becoming the tab on screen, so a second handle on them would be a second
  // way to ask for the same thing.
  const panelRefresh =
    activeTab === "pr"
      ? { onRefresh: pullRequests.refresh, loading: pullRequests.loading }
      : activeTab === "issue"
        ? { onRefresh: issueData.refresh, loading: issueData.loading }
        : activeTab === "docs"
          ? {
              onRefresh: () => refreshActiveDoc(selectedSessionId),
              loading: activeDoc?.body.status === "loading",
            }
          : null;

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

  // A click on a markdown path in the transcript, which is the one route in.
  // Off the counter rather than off `docs.length`, since reopening a file that
  // is already open leaves the list unchanged and still has to bring the pane
  // forward.
  //
  // The pick moves as well as the pane, and has to, for the same reason
  // `usePullRequest`'s `onOpened` writes one: `activeTab` honours a standing
  // pick over the derived default, and `handleTogglePanel` stores "changes"
  // every time the pane opens onto a turn that touched files.
  const lastOpened = useRef(docsOpened);
  useEffect(() => {
    if (docsOpened === lastOpened.current) return;
    lastOpened.current = docsOpened;
    setPanelTab("docs");
    setPanelOpen(true);
  }, [docsOpened, setPanelTab, setPanelOpen]);

  // The same signal for the other half of a file link: a path that is not
  // markdown opens on the Files tab. A counter for the docs panel's reason —
  // reopening a file already on screen leaves the list unchanged, so only a
  // count of *clicks* can say the reader asked.
  const lastFileOpened = useRef(filesOpened);
  useEffect(() => {
    if (filesOpened === lastFileOpened.current) return;
    lastFileOpened.current = filesOpened;
    if (!pageOpen) showPanelTab("files");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesOpened]);

  // A link in the transcript opens as a new tab in the session's browser and
  // brings the pane up on it, unless it is already showing that browser.
  // ⌘-click, or no session to hold one, goes to the system browser.
  useEffect(() => {
    setLinkOpener((url, { external }) => {
      if (external || !selectedSessionId) {
        void openUrl(url).catch(console.error);
        return;
      }
      // The session is named outright: the read lands after an await, and by
      // then the reader may be on another session whose pane must stay put.
      void openInBrowser(selectedSessionId, url, true)
        .then(() => {
          if (browserShown) return;
          setPanelTab("browser", selectedSessionId);
          setPanelOpen(true, selectedSessionId);
        })
        .catch(() => {
          // Answered by the system browser, so the pane has nothing to say.
          clearOpenError(selectedSessionId);
          void openUrl(url).catch(console.error);
        });
    });
    return () => setLinkOpener(null);
  }, [selectedSessionId, browserShown, setPanelTab, setPanelOpen]);

  // An element picked in the page lands in that session's draft, and the
  // composer is focused to show it. The browser sits beside the transcript
  // rather than over it, so there is nothing to leave first.
  useEffect(() => {
    setPickHandler((sessionId, element) => {
      if (!element) return;
      appendToDraft(sessionId, describePick(element));
      if (sessionId !== selectedSessionId) return;
      focusComposer();
    });
    return () => setPickHandler(null);
  }, [selectedSessionId]);

  // The first browser tab appearing — an agent opening a page — brings the
  // pane up on Browser, once. Not while it is already showing, which is the
  // same page in the same place. Only a change within one session counts, and
  // only from a *known* empty list: arriving at a session that already holds a
  // tab, or its first read landing, is the reader looking, not the agent
  // acting, and both used to pop the pane open (DRA-184).
  const lastTabs = useRef({ id: selectedSessionId, had: hasBrowserTabs });
  useEffect(() => {
    const was = lastTabs.current;
    lastTabs.current = { id: selectedSessionId, had: hasBrowserTabs };
    if (was.id !== selectedSessionId || was.had !== false) return;
    if (hasBrowserTabs && !browserShown) showPanelTab("browser");
  }, [selectedSessionId, hasBrowserTabs, browserShown, showPanelTab]);

  // Every way of arriving at a session, so none of them can forget to leave the
  // pages. The two sidebar buttons closed one and the chords beside them did not,
  // which made ⌘N and ⌘⇧↑/↓ look inert: they moved the selection under a column
  // still full of issues, and the change only showed up on the way back. A page is
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
  const openIssues = useCallback(() => {
    setPage("issues");
  }, []);
  const openPrs = useCallback(() => {
    setPage("prs");
  }, []);
  const openPlugins = useCallback(() => {
    setPage("plugins");
  }, []);

  /// One way to press any of the three, and drawn by all three surfaces.
  ///
  /// The tab is not a local swap of which rows a list holds — it is *the page
  /// changing*, and the two pages it changes to carry their own search, sort,
  /// filters, refresh and detail pane. `counts` comes from the shell's own read
  /// of both halves, so the same row says the same numbers wherever it is drawn.
  const selectInboxPage = useCallback((next: InboxPage) => setPage(next), []);

  /// Moves the whole window to another space. The screen catches up in the
  /// effect below, which answers for every way membership can change and not
  /// only for this one.
  ///
  /// Notices go here rather than there: a card raised before the switch names a
  /// session the reader has just put away, and clicking it would open that
  /// transcript. They are transient anyway, so dropping one costs a glance at
  /// something the sidebar still marks.
  ///
  /// Kept only where the session can be *shown* to belong here — `allowedInSpace`,
  /// the same reading `announce` makes, since a card and a banner say the same
  /// sentence. A settled session is in neither list the moment the reader is on
  /// the live one, so matching on the index alone kept exactly the cards nobody
  /// could account for.
  const changeSpace = (next: string | null) => {
    setStoredSpace(next);
    setProjectFilter(null);

    for (const notice of getNotices()) {
      const path =
        sessionIndexItems.find((i) => i.sessionId === notice.sessionId)?.projectPath ??
        sessions.find((s) => s.sessionId === notice.sessionId)?.projectPath ??
        null;
      if (!allowedInSpace(projects, next, path)) {
        dismissNotice(notice.sessionId, notice.kind);
      }
    }
  };

  /// Declares a space, and reports it only where one is actually made.
  ///
  /// The check is duplicated outside the updater rather than read from inside
  /// it, and that is the point: React may call an updater twice, so a report in
  /// there would count one space as two. Judged against `spaces`, the union —
  /// re-declaring a name some project already carries as a tag is not a new
  /// space to the reader, whatever the declared half of the list says.
  const createSpace = (name: string) => {
    setDeclaredSpaces((prev) => (prev.includes(name) ? prev : [...prev, name]));
    if (!spaces.includes(name)) trackFeature("space_created");
  };

  /// Steps a space one place in the order the switcher walks.
  ///
  /// The **whole** list goes down, not the declared half of it: order is the
  /// declared list, and a space carried only by a project's tag has no place in
  /// it yet — so a name is declared here on the way past, which is the only way
  /// it can have somewhere to be moved to. Membership is untouched either way,
  /// since the tag on the project is what records that.
  const moveSpaceBy = (name: string, delta: number) =>
    setDeclaredSpaces(moveSpace(spaces, name, delta));

  /// Renames a space wherever it is written down: every project carrying the
  /// tag, the declared list, and the reader's own pick.
  ///
  /// The tags move first and in **one** call, and the local record follows only
  /// once that lands. A loop of writes with the record updated up front left
  /// half-renamed tags beside a list claiming the rename was done, which is a
  /// disagreement nothing on screen could explain.
  const renameSpace = async (from: string, to: string) => {
    if (!(await retagSpace(from, to))) return;
    setDeclaredSpaces((prev) => [...new Set(prev.map((s) => (s === from ? to : s)))]);
    // Groups are filed by the space's name, so they follow it — left tagged
    // with the old one they would vanish, and come back under a later space
    // that happened to take the name.
    setGroups((prev) => prev.map((g) => (g.space === from ? { ...g, space: to } : g)));
    if (storedSpace === from) setStoredSpace(to);
  };

  /// Removes a space and files its projects under none. The projects and their
  /// sessions are untouched — a space is a way of looking at them, so losing one
  /// costs the view and never the work.
  const removeSpace = async (name: string) => {
    if (!(await retagSpace(name, null))) return;
    setDeclaredSpaces((prev) => prev.filter((s) => s !== name));
    // Its groups go where its projects go: under none, which is every project.
    setGroups((prev) => prev.map((g) => (g.space === name ? { ...g, space: null } : g)));
    if (storedSpace === name) changeSpace(null);
  };

  /// Keeps what is *on screen* inside the active space — the composer's project
  /// and the open transcript, neither of which the sidebar's filtering reaches.
  ///
  /// An effect rather than three lines inside the switcher, because switching
  /// is not the only way a session leaves the space it was in: filing a project
  /// into another space or detaching it moves the same boundary, and a stale
  /// notification opening a session moves the reader across it. Written as
  /// "what is showing must be in the space" rather than as a list of the ways
  /// it stops being, each of which was its own bug.
  ///
  /// The project is judged first and independently: a space holding nothing is
  /// an ordinary state, and clearing the pick there is what stops the composer
  /// starting a task in a project the reader can no longer see.
  ///
  /// A session whose project neither the index nor the loaded snapshot can name
  /// is left alone. That is "we cannot tell", not "it is elsewhere", and
  /// closing a transcript on a guess is worse than drawing one a moment longer.
  ///
  /// **Layout, not effect**: an ordinary effect runs after the browser paints,
  /// so the switch drew one frame of the transcript being switched away from.
  /// A frame is nothing to a reader who chose to switch and everything to the
  /// room watching them share the screen, which is the whole reason spaces
  /// exist. The body is two array scans, which is what makes blocking paint on
  /// it affordable.
  useLayoutEffect(() => {
    if (projectPath && !spaceProjects.some((p) => p.path === projectPath)) {
      handleSelectProject(spaceProjects[0]?.path ?? null);
    }

    if (!selectedSessionId) return;
    const openPath =
      selectedSession?.projectPath ??
      sessionIndexItems.find((i) => i.sessionId === selectedSessionId)?.projectPath;
    if (openPath && !sessionInSpace(projects, space, openPath)) {
      goToSession(handleNewSession);
    }
    // The membership question and its two answers. `handleSelectProject` and
    // `handleNewSession` are rebuilt every render, so listing them would run
    // this on every one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, projects, spaceProjects, projectPath, selectedSessionId, selectedSession, sessionIndexItems]);

  /// The sidebar's own "New space", which is a request for the field rather
  /// than for a space — naming it is Settings' job, so this only opens the tab.
  const openNewSpace = () => {
    setSettingsTab("spaces");
    setNamingSpace(true);
    setSettingsOpen(true);
  };

  /// Leaves the issues page for the empty composer, with the issue tagged in
  /// the draft.
  ///
  /// The tag alone is the whole handoff: `expand_tags` resolves it out of the
  /// prompt text on send, so nothing is linked here. It lands in the composer
  /// rather than starting a session, which is what leaves the project, the
  /// model and the harness still to be picked.
  const workOnIssue = (issue: { identifier: string; title: string }) => {
    goToSession(handleNewSession);
    appendToDraft(null, issueTag(issue.identifier, issue.title));
  };

  /// Starts a new chat *as* an Agent, from the Agents screen.
  ///
  /// **It sets the composer's own pick rather than sending anything.** The Agent
  /// a session runs as is chosen at creation and cannot be changed afterwards, so
  /// the honest handoff is to arrive at the composer with that Agent already
  /// picked — the reader adds the work, chooses the project and presses Enter,
  /// and the picker on the row shows what they are about to start.
  const chatWithAgent = (name: string) => {
    setAgentName(name);
    goToSession(handleNewSession);
  };

  /// Writes a session's settled or pinned flag and takes the sidebar wherever
  /// that write left the row.
  ///
  /// One function because there are two ways to unsettle — the sidebar row's
  /// menu and the composer's own bar — and they have to land in the same place.
  /// The bar reached `setSessionFlags` directly at first, which wrote the flag
  /// and nothing else: the row left the settled list it was drawn from, the
  /// view stayed settled, and the session the reader had just taken back was
  /// nowhere on screen.
  const handleSetSessionFlags = async (
    sessionId: string,
    flags: { archived?: boolean; pinned?: boolean },
  ) => {
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
  };

  const toggleSidebar = () => setCollapsed((prev) => !prev);
  useHotkey("sidebar.toggle", toggleSidebar);
  // Takes the sidebar with it: the field lives there, and a chord that opened a
  // search nobody can see would be worse than no chord. `autoFocus` covers the
  // field this press mounts; the select covers the one already on screen, which
  // is also what makes ⌘F on a query a replace rather than an append.
  // **The chord opens the view, not a field in the sidebar.** One screen holds the
  // box, the scopes and the results, and it opens from a collapsed sidebar as
  // readily as from an open one.
  useHotkey("search", () => setPage("search"));
  useHotkey("session.new", () => goToSession(handleNewSession));
  // Steps the composer's project picker, and only while that picker is on
  // screen: it is drawn for a new task alone, and `enabled` unregisters rather
  // than no-opping, so a session's composer doesn't have ⌘⇧P eaten from it.
  // Wraps, since one key with a clamp dead-ends on the last project with no way
  // back. Nothing picked yet finds no index and lands on the first, which is
  // also the answer for a project detached out from under the pick.
  useHotkey(
    "project.next",
    () => {
      const next =
        spaceProjects[
          (spaceProjects.findIndex((p) => p.path === projectPath) + 1) % spaceProjects.length
        ];
      if (next) handleSelectProject(next.path);
    },
    {
      // The chord steps exactly what the picker draws, which under a space is
      // that space's projects — a chord landing on one the menu never offered
      // is a session started somewhere the reader cannot see.
      enabled: !selectedSessionId && !pageOpen && spaceProjects.length > 1,
    },
  );
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
  // The bare ⌘ digits go to the panes, since focus is what moves most inside
  // a grid; the pane's tabs take ⌘⌥ below. Not ⌘⇧, which macOS spends on
  // screenshots for exactly these digits. Bound only while a grid is *on
  // screen*: with none ⌘1 has nothing to point at and must not eat the key,
  // and behind a page — or behind the pane at its wide size — ⌘W would close a
  // pane the reader cannot see.
  const gridShown = !!activeGroup && !pageOpen && !panelWide;
  const paneIds = activeGroup ? paneOrder(activeGroup) : [];
  // Keyboard focus moves with the pane. A click moves it by itself, but a
  // chord left it on whatever the old pane held — a link, a subagent control
  // — and Enter there then acted through the *selected* session, since every
  // opener resolves ownership from the selection. The composer is where the
  // reader's next keystroke belongs anyway.
  const focusPane = (n: number) => {
    const id = paneIds[n - 1];
    if (!id) return;
    void handleSelectSessionIndexItem(id);
    focusComposer();
  };
  // Nine digits, so a tenth pane has no chord — it still takes a click. A
  // fixed list, so the hook count never moves between renders.
  // biome-ignore lint/correctness/useHookAtTopLevel: a fixed list, so the count and order never move between renders
  for (const n of PANE_DIGITS) useHotkey(`pane.${n}`, () => focusPane(n), { enabled: gridShown });
  // ⌘W closes the innermost thing the main column has open, which is what it
  // means in every editor and browser this app is read beside. The views are
  // mutually exclusive, so the chain is an ordering rather than an
  // arbitration — bar the last arm, which is the reader on Chat with the
  // browser beside it in the panel and no grid to close a pane out of.
  const closeBrowserTab = () => {
    if (!selectedSessionId) return;
    // The pending tab has no browser behind it, so it is dropped rather than
    // closed — and it is what the reader is looking at while it is up.
    if (pendingBrowserTab) return setPendingTab(selectedSessionId, false);
    const open = browserTabs?.find((tab) => tab.active);
    if (open) void closeTab(selectedSessionId, open.id);
  };
  // A page hides the pane without clearing its tab, so a reader who opened
  // Issues from the Files tab would still have `activeFile` naming a file in a
  // view nobody can see — and ⌘W there closed it silently. `panelShown` is the
  // one predicate that covers that, and the other arms carry `!pageOpen`.
  const fileShown = panelShown && activeTab === "files" && !!activeFile;
  const closeTabOrPane = () => {
    // **First, and ahead of the session guard below.** The pull-requests page's
    // tabs are the reader's pull requests rather than a session's views, so no
    // other arm can see them — and every one of those needs a session, which
    // this does not.
    if (prsOpen && activePrKey) return closePr(activePrKey);
    if (!selectedSessionId) return;
    if (fileShown && activeFile) return closeFile(selectedSessionId, activeFile);
    if (browserShown) return closeBrowserTab();
    if (gridShown) return closeSessionPane(selectedSessionId);
  };
  // Bound only where it has something to close: `useHotkey` claims every chord
  // it matches, and a ⌘W that eats the key and does nothing is worse than one
  // the app never had.
  const hasCloseTarget =
    (prsOpen && !!activePrKey) ||
    fileShown ||
    (browserShown && (pendingBrowserTab || !!hasBrowserTabs)) ||
    gridShown;
  useHotkey("tab.close", closeTabOrPane, { enabled: hasCloseTarget });
  // ⌘E for the right pane against ⌘B for the left.
  //
  // Bound to the raw toggle rather than to `handleTogglePanel`, deliberately:
  // that one picks a tab on the way open, which is right for a button the
  // reader aimed at and wrong for a chord that draws nothing and so promises
  // nothing. What the two do share is the page guard, which is why that half is
  // `closePagePane` rather than a line repeated here — repeated, the chord went
  // straight past the button's guard into a pane that is not on screen.
  useHotkey("panel.toggle", () => {
    if (closePagePane()) return;
    togglePanel();
  });
  // The pane's other size, and deliberately **not** sharing that guard: a page
  // owns the column, so there is nothing to expand into and ⌘E's job of
  // closing the page first is not what was asked for here. `togglePanelWide`
  // no-ops instead.
  useHotkey("panel.expand", togglePanelWide);
  // ⌘⇧[ / ⌘⇧] — the browser and editor chord for stepping through tabs, so it
  // arrives already known. The shift layout reaches `key`, so the character is
  // `{` rather than `[`; the physical key rides along for the engines that
  // report the unshifted one — see `code`.
  useHotkey("panel.tab.prev", () => stepTab(-1));
  useHotkey("panel.tab.next", () => stepTab(1));
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
    if (issuesOpen) {
      if (pickedIssue) return pickedIssueData.refresh();
      return issuesRefreshRef.current?.();
    }
    if (prsOpen) return prsRefreshRef.current?.();
    if (pluginsOpen) return pluginsRefreshRef.current?.();
    if (panelShown) panelRefresh?.onRefresh();
  });
  // ⌘S writes the doc on screen. Unregistered rather than a no-op off that tab:
  // `useHotkey` claims every chord it matches, and ⌘S is the browser's own save
  // — left bound everywhere it would eat the key from nothing at all.
  useHotkey("doc.save", () => saveActiveDoc(selectedSessionId), {
    enabled: panelShown && activeTab === "docs",
  });
  // Each names the view it opens rather than its slot in the row, so a
  // rebinding moves one chord and never the set. No-ops behind a page, where
  // the pane is hidden: opening a tab nobody can see looks like nothing
  // happening and shows up as the wrong view on the way back. Without a
  // session the pane's setters no-op on their own, having no id to key.
  //
  // Under ⌘⌥, with the bare ⌘ digits given to the panes: inside a grid the
  // focus moves many times a minute, where a view is a mode changed a few
  // times a session. `code`, since Option turns a digit's `key` into a symbol.
  useHotkey("view.changes", () => !pageOpen && showPanelTab("changes"));
  useHotkey("view.browser", () => !pageOpen && showPanelTab("browser"));
  useHotkey("view.files", () => !pageOpen && showPanelTab("files"));
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
  // Only means anything before a session exists — the worktree is where the
  // agent starts — so it is unregistered rather than a no-op there. `useHotkey`
  // claims every chord it matches, and ⌘⇧T is reopen-closed-tab in a webview:
  // left bound on a session that cannot use it, it would eat the key and do
  // nothing.
  const composingNewSession = !selectedSessionId && !pageOpen;
  useHotkey("worktree.toggle", () => setUseWorktree((v) => !v), {
    // A worktree has nothing to fork from until a project is picked, which is
    // the same condition the toggle itself is drawn under.
    enabled: composingNewSession && projectPath !== null,
  });
  // No accelerator: Shift+Tab on its own, and the model gets it because the
  // model is the pick reached for most often. The CLI spends this chord on
  // permission mode, which in practice gets set once and left.
  //
  // Cycles rather than opening the picker, which is what makes it worth a
  // chord at all: a menu that then wants arrows and Enter is three keys to do
  // what the trigger does in one click. Sane only because the cycle is short,
  // so a wrong landing is one more press away from right. Leaves each model's
  // own remembered effort alone, same as picking it from the menu.
  //
  // `cycledModels` is what the picker draws plus the model the session is on.
  // The menu draws every model the providers serve — 37 of them here — so the
  // chord is only worth having because the reader can shorten it: switching a
  // model off in settings takes it out of both, and what is left is the list
  // they actually switch between.
  //
  // One press is one **model**, whatever the wire spent on it: a model with
  // variants is one row and one stop, and landing on one leaves the variant it
  // is already on alone.
  //
  // A session already on a model outside the list enters the cycle at its
  // start, the same convention `nextEffort` takes for a level it doesn't
  // cycle.
  useHotkey("model.next", () => {
    const cycle = cycledModels(models, harness, modelId);
    if (cycle.length < 2) return;
    const index = cycle.findIndex((row) => row.variants.some((m) => m.id === modelId));
    const next = rowModel(cycle[(index + 1) % cycle.length], modelId);
    handleModelChange(next.id, null);
  });
  // ⌘⇧E for effort, beside ⌘E for the right pane — near enough to remember and
  // no collision, since `useHotkey` matches Shift exactly and neither listener
  // answers the other's chord. No `code`: that option is for a chord whose
  // character *changes* under Shift, and Shift+E is still an E — the matcher
  // lowercases both sides.
  useHotkey("effort.next", () => {
    const next = nextEffort(models.find((m) => m.id === modelId), effort);
    if (next) handleModelChange(modelId, next);
  });
  // Opens, and does nothing where the page is already up — the same answer the
  // sidebar row gives, since that is the only other route in. Not a toggle:
  // nothing on that page opens the pane either (⌘E closes only there), and a
  // chord that closed it would have to pick somewhere to land, which is the
  // guess `goToSession` exists so nothing has to make.
  useHotkey("issues.open", openIssues);
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
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const rows: PaletteItem[] = [];

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

    // What searching the logs answered, under the sessions they belong to. The
    // rows above are places to go; these are things that were said, and the
    // reader who typed a word they remember is after the second.
    for (const hit of messageHits) {
      rows.push({
        kind: "match",
        // Session *and* position: two hits in one session are two rows, and the
        // session id alone would collide.
        id: `${hit.sessionId}:${hit.seq}`,
        label: hit.title,
        detail: hit.snippet,
        run: () => goToSession(() => void handleSelectSessionIndexItem(hit.sessionId)),
      });
    }

    // The files themselves, under the messages: a message hit is where a word was
    // *said*, and this is where it *is*. The row opens the line in the session's
    // file view, which is the place to read it.
    if (contentHits) {
      rows.push(
        ...contentRows(contentHits.matches, (hit) => {
          void openInFiles(selectedSessionId, hit.path, hit.line);
        }),
      );
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

    for (const name of spaces) {
      // Only the switch itself: filing and retagging live in Settings, where a
      // project's space is a row rather than a decision to make mid-thought.
      if (name === space) continue;
      rows.push({ kind: "space", id: name, label: name, run: () => changeSpace(name) });
    }

    const actions: { id: ShortcutId; label: string; run: () => void }[] = [
      { id: "session.new", label: "New task", run: () => goToSession(handleNewSession) },
      // The row and the chord do the same thing, which is what a palette row is
      // for — and it is the same thing whether or not the sidebar is up.
      { id: "search", label: "Search", run: () => setPage("search") },
      { id: "sidebar.toggle", label: "Toggle the sidebar", run: toggleSidebar },
      {
        id: "panel.toggle",
        label: "Toggle the panel",
        // The same function the chord takes, rather than a copy of its rule: a
        // page hides the pane, so the press would land somewhere else entirely.
        // Written out here it was a list of pages that had already gone stale —
        // it named issues and not pull requests, and the plugins page would have
        // been a third thing to remember.
        run: () => {
          if (closePagePane()) return;
          togglePanel();
        },
      },
      { id: "inbox.open", label: "Open inbox", run: openInbox },
      { id: "issues.open", label: "Open issues", run: openIssues },
      { id: "prs.open", label: "Open pull requests", run: openPrs },
      { id: "plugins.open", label: "Open plugins", run: openPlugins },
      { id: "settings", label: "Settings", run: () => setSettingsOpen(true) },
    ];

    if (selectedSessionId && !pageOpen) {
      actions.push(
        {
          id: "panel.expand",
          // The label follows the state, since a row that says "Expand" over an
          // expanded pane is a row that promises the wrong thing.
          label: panelWide ? "Restore the panel" : "Expand the panel",
          run: togglePanelWide,
        },
        { id: "view.changes", label: "Show the diff", run: () => showPanelTab("changes") },
        { id: "view.browser", label: "Show the browser", run: () => showPanelTab("browser") },
        { id: "view.files", label: "Show the files", run: () => showPanelTab("files") },
      );
    }

    for (const action of actions) {
      rows.push({ kind: "action", id: action.id, label: action.label, shortcut: action.id, run: action.run });
    }

    return rows;
  }, [
    ordered,
    projects,
    spaces,
    space,
    // Everything `closePagePane` reads, which the panel row now calls. The row
    // used to spell the guard out itself and needed none of these — and could not
    // be stale — but sharing the rule is worth naming what it depends on: a row
    // built from an old pick would close the wrong thing, or nothing.
    pickedIssue,
    pluginsTab,
    activePrKey,
    selectedSessionId,
    handleSelectSessionIndexItem,
    handleSelectProject,
    handleNewSession,
    toggleSidebar,
    togglePanel,
    changeSpace,
    openInbox,
    openIssues,
    openPrs,
    openPlugins,
    pageOpen,
    prsCwds,
    showPanelTab,
    panelWide,
    togglePanelWide,
    messageHits,
  ]);

  const fullscreen = useFullscreen();
  useGlass(fullscreen);

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

  return (
    <TooltipProvider>
    <DiffWorkerPool pair={codeThemePair}>
    <AppShell
      // The issues page fills the column, so the centred empty-composer state
      // is wrong there even with no session selected.
      centered={!selectedSession && !pageOpen}
      columnHidden={panelWide}
      overlay={singleDrop && <DropZone region={singleDrop.region} label={singleDrop.label} />}
      sidebar={
        <Sidebar
          items={visibleSessions}
          onOpenSearch={() => setPage("search")}
          projects={spaceProjects}
          spaces={spaces}
          space={space}
          onSpaceChange={changeSpace}
          onNewSpace={openNewSpace}
          // Only while the dialog is actually up: it is cleared on close, so a
          // cancelled naming puts the switcher back on All Spaces by itself.
          namingSpace={settingsOpen && namingSpace}
          projectFilter={projectFilter}
          onProjectFilterChange={setProjectFilter}
          statusBySession={statusBySession}
          askingSessions={askingSessions}
          prFor={prMarks.prFor}
          // The whole roster, not the selected session's slice: a subagent is
          // drawn under the session that delegated it, so the sidebar needs every
          // live session's.
          delegations={delegationsBySession}
          onOpenSubagent={openSubagentView}
          openSubagentKey={openSubagentKey}
          // Cleared while a page is up. The column is showing that page, so a
          // lit row would name a session that is nowhere on screen — and the
          // selection itself is kept, which is what makes coming back free.
          selectedSessionId={pageOpen ? null : selectedSessionId}
          collapsed={collapsed}
          onToggleCollapsed={toggleSidebar}
          onOpenSettings={() => setSettingsOpen(true)}
          onSelect={(sessionId) =>
            goToSession(() => {
              // **The row is the way out of a subagent too.** Landing back on the
              // parent with its child's conversation still filling the column is
              // the one case the selection-changed rule cannot catch: the
              // selection does not move. Dropped here so the click always lands
              // on the session's own transcript.
              setSubagentView(null);
              void handleSelectSessionIndexItem(sessionId);
            })
          }
          groups={spaceGroups}
          onDropSession={dropSession}
          splitLearned={splitLearned}
          onNewSession={() => goToSession(handleNewSession)}
          onNewSessionInProject={(path) =>
            goToSession(() => {
              handleSelectProject(path);
              handleNewSession();
            })
          }
          onOpenPlugins={openPlugins}
          pluginsOpen={pluginsOpen}
          onOpenInbox={openInbox}
          // All three: the inbox and the two pages it launches into are one
          // destination in this column, and the two have no row of their own.
          // Lit on the inbox alone, a reader who opened an issue from it would
          // see nothing saying where they are or how to get back.
          inboxActive={inboxOpen || issuesOpen || prsOpen}
          onDetach={detachSession}
          onSetFlags={handleSetSessionFlags}
          onFork={forkSession}
          onDelete={deleteSession}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((v) => !v)}
          updateStatus={updateStatus}
          updateBlocked={anyRunning}
          updateManual={updateManual}
          onInstallUpdate={() => void installUpdate()}
        />
      }
      header={
        <header
          // `overflow-hidden` is the containment: whatever runs out of room in
          // here must clip at the column's edge, never spill over the pane
          // beside it. Every child below decides how it gives up width; this
          // decides that it has to.
          className="flex h-(--titlebar-h) shrink-0 items-center gap-2 overflow-hidden px-3"
          // `deep`, not bare: bare drags only on direct hits, so every label
          // inside this row was a dead strip in a titlebar that looks uniform.
          // Buttons still block on their own — Tauri stops walking up at any
          // clickable element that carries no attribute of its own.
          data-tauri-drag-region="deep"
        >
          {/* Only when collapsed — expanded, the sidebar owns the toggle and
              already covers this edge. */}
          {sidebarLead}

          {/* **The way back out of a subagent.** The view fills the column and the
              composer is gone with it, so this arrow is the only control saying
              the column can be left — and drawn against the session's own name it
              is what says whose subagent is on screen. */}
          {subagentView && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={closeSubagentView}
              aria-label="Back to the session"
              className="shrink-0"
            >
              <ChevronLeft className="size-4" />
            </Button>
          )}

          {subagentView ? (
            // **The header names what the column is showing**, the same bargain
            // `SessionHeader` makes — and the subagent view draws no bar of its
            // own, because the chat it is does not have one either.
            <div className="flex min-w-0 flex-1 items-center gap-2 text-ui">
              <BloubAvatar
                name={openSubagentAgent ?? openSubagentTitle}
                size={16}
                live={openSubagentLive}
                mood={openSubagentLive ? "working" : "done"}
              />

              <span
                className={cn(
                  "min-w-0 truncate font-medium text-foreground",
                  openSubagentLive && "shimmer-text",
                )}
              >
                {openSubagentTitle}
              </span>

              {openSubagentStatus && (
                <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-xs text-muted-foreground">
                  {statusWord(openSubagentStatus)}
                </span>
              )}
            </div>
          ) : (
            <SessionHeader
              session={selectedSession}
              branch={prBranch}
              // The group's name over a grid: each pane's header already names
              // its session, and the focused one's repeated up here read as a
              // second line of the same row.
              standIn={
                searchPageOpen
                  ? "Search"
                  : inboxOpen
                  ? "Inbox"
                  : issuesOpen
                  ? "Issues"
                  : prsOpen
                    ? "Pull requests"
                    : pluginsOpen
                      ? "Plugins"
                      : activeGroup
                        ? groupName(activeGroup)
                        : null
              }
              className="flex-1"
            />
          )}

          {subagentView && openSubagentLive && selectedSessionId && (
            <StopDelegations sessionId={selectedSessionId} onStop={stopDelegations} />
          )}

          {issuesOpen
            ? // Only once something is open to close. Nothing on this page can
              // *open* the pane — a row does that — so a toggle drawn at rest
              // would be a control with one dead state.
              pickedIssue && (
                <PanelToggle onToggle={() => setPickedIssue(null)} open changes={false} />
              )
            : prsOpen
              ? // The same control the issues page draws, for the same reason,
                // and it was missing here: the only toggle on this page was the
                // *session's*, which a reader pointed at the detail beside it —
                // and whose press closed the whole page instead.
                (pickedRun || activePrKey) && (
                  <PanelToggle
                    // Innermost first, the order the pages' own toggles take: the
                    // run, then the pull request tab behind it.
                    onToggle={() => {
                      if (pickedRun) setPickedRun(null);
                      else if (activePrKey) closePr(activePrKey);
                    }}
                    open
                    changes={false}
                  />
                )
              : pluginsOpen
                ? // The page's own, for the reason the two above draw one: a row on
                  // this page is the only thing that can open the pane, so the
                  // toggle is the way back out of it.
                  hasPick(pluginsTab) && (
                    <PanelToggle
                      onToggle={() => setPluginsTab(sectionTab(pluginsTab.section))}
                      open
                      changes={false}
                    />
                  )
                : selectedSession && (
                  <PanelToggle
                    onToggle={handleTogglePanel}
                    open={panelOpen}
                    changes={lastTurnChanged}
                    pr={hasOpenPr && hasPrTab}
                    draft={allDrafts}
                  />
                )}
        </header>
      }
      panel={
        // The pane describes whatever the main column is showing. On the issues
        // page that is an issue and never a session — which is the whole reason
        // the session's pane is hidden there: left up, it went on describing
        // changes and a pull request belonging to work the reader had left.
        pluginsOpen ? (
          <RightPanel
            open={hasPick(pluginsTab)}
            // The word follows the section: this pane is about a Skill under one,
            // a server under the next and an Agent under the third, and a heading
            // naming the wrong one is the pane describing something that is not on
            // the page.
            heading={
              pluginsTab.section === "skills"
                ? "Skill"
                : pluginsTab.section === "mcp"
                  ? "MCP server"
                  : "Agent"
            }
            // The tab id does not follow it — a heading is what is drawn, and two
            // ids for one pane would be two things `PANEL_TABS` has to keep.
            tab="skill"
            onTabChange={() => {}}
          >
            <TabBody active>
              <Suspense fallback={null}>
                  {pluginsTab.section === "skills" ? (
                    <PluginSkillDetail skill={pickedSkillOf(pluginsTab)} />
                  ) : pluginsTab.section === "mcp" ? (
                    <McpForm
                      pick={mcpPickOf(pluginsTab)}
                      onClose={() => setPluginsTab(sectionTab("mcp"))}
                      // A new server has no row to have been picked, so the pane moves
                      // onto what was just created rather than staying on a blank form.
                      onSaved={(name) =>
                        setPluginsTab({ section: "mcp", pick: { mode: "server", name } })
                      }
                    />
                  ) : (
                    <AgentForm
                      pick={agentPickOf(pluginsTab)}
                      onClose={() => setPluginsTab(sectionTab("agents"))}
                      // The same bargain the server form makes: creation has no row to
                      // have been picked, so the pane moves onto what was just written.
                      onSaved={(name) =>
                        setPluginsTab({ section: "agents", pick: { mode: "agent", name } })
                      }
                      onChat={chatWithAgent}
                    />
                  )}
              </Suspense>
            </TabBody>
          </RightPanel>
        ) : prsOpen && pickedRun ? (
          // **The run's own pane, and it takes the frame whole.** A strip of the
          // reader's pull requests beside a run would be a second list at the
          // top of a pane that is answering one question, and the way back is
          // the row they clicked.
          <RightPanel
            open
            heading="Run"
            // **A word rather than a tab row, and the id is the page's.** This
            // pane belongs to the pull-requests page — the Actions sub-tab is
            // that page's own — so it keeps that page's tab id and overrides the
            // word, the bargain the issues pane makes with `heading="Details"`.
            tab="pr"
            onTabChange={() => {}}
            refresh={{ onRefresh: () => prsRefreshRef.current?.(), loading: false }}
          >
            <TabBody active>
              <Suspense fallback={null}>
                <RunDetail
                  // Keyed on the run, so the pick resets a read, a scroll and an
                  // open error rather than carrying them onto the next one.
                  key={`${pickedRun.cwd}#${pickedRun.id}`}
                  run={pickedRun}
                  active={prsOpen}
                  // The page re-reads: a re-run changes the row's state, and a
                  // list still calling it failed would be this pane contradicted
                  // two inches away.
                  onChanged={() => prsRefreshRef.current?.()}
                />
              </Suspense>
            </TabBody>
          </RightPanel>
        ) : prsOpen ? (
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
            tab="pr"
            onTabChange={() => {}}
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
        ) : issuesOpen ? (
          <RightPanel
            open={!!pickedIssue}
            // A word rather than a tab row: there is one thing in this pane
            // and nothing to switch to. "Details" and not "Issue", which would
            // name the tab this replaced and say the same thing as the pane's
            // own contents.
            heading="Details"
            tab="issue"
            onTabChange={() => {}}
            refresh={{
              onRefresh: pickedIssueData.refresh,
              loading: pickedIssueData.loading,
            }}
            // In the strip rather than on the issue's own row, beside Refresh:
            // it acts on the issue the pane is showing, which is the pane's
            // whole subject — the same slot Open takes for a session.
            actions={
              pickedIssue && (
                <Button variant="secondary" size="xs" onClick={() => workOnIssue(pickedIssue)}>
                  Work on it
                  <Plus data-icon="inline-end" />
                </Button>
              )
            }
          >
            <TabBody active>
              <IssuePanel
                // No session, so no link to remove — the row draws its open-in-
                // tracker button and nothing else.
                sessionId={null}
                issues={pickedIssueRefs}
                onUnlink={() => {}}
                details={pickedIssueData.details}
                loading={pickedIssueData.loading}
                unavailable={pickedIssueData.unavailable}
              />
            </TabBody>
          </RightPanel>
        ) : // Mounted whenever a session is, open or not — closing or switching
        // tabs only hides, so reopening shows what was already there instead of
        // refetching and re-highlighting it. `active` is what stops the hidden
        // changes tab from snapshotting the working tree in the background.
        selectedSession ? (
          <RightPanel
            open={panelShown}
            // Wide, this row is what reaches the window's left edge — the header
            // that normally carries the collapsed sidebar's toggle is behind the
            // pane, so both the clearance and the way back ride here instead.
            lead={panelWide ? sidebarLead : undefined}
            wide={panelWide}
            onToggleWide={togglePanelWide}
            tab={activeTab}
            onTabChange={setPanelTab}
            counts={{
              pr: prBadgeCount(pullRequests.prs),
              // Only above one: a tab reading "Issue 1" says what the tab
              // already says, and the count is news exactly when there is more
              // than one thing behind it.
              issue: sessionIssues.length > 1 ? sessionIssues.length : 0,
              // Same rule, and beside it so the rule reads once: the count is
              // news exactly when there is more than one file behind the tab.
              docs: docs.length > 1 ? docs.length : 0,
            }}
            pr={hasPrTab}
            docs={hasDocsTab}
            issue={hasIssueTab}
            todo={hasTodoTab}
            refresh={panelRefresh}
            cwd={selectedSession.cwd}
            actions={
              // On the Diff tab alone: a review is of the turn, and the turn's
              // own range is what that tab draws. Nowhere else in the pane is
              // there anything to have an opinion about.
              activeTab === "changes" ? (
                <SecondOpinionAction
                  models={models}
                  busy={secondOpinionBusy}
                  disabled={!head || !targetPath}
                  onPick={(model) => {
                    setSecondOpinionBusy(true);
                    void startSecondOpinion(model).finally(() =>
                      setSecondOpinionBusy(false),
                    );
                  }}
                />
              ) : null
            }
          >
            <TabBody active={activeTab === "changes"}>
              {/* Keyed by session so the selection, the sub-tab and the open
                  commit reset with it, the same bargain the Files tab makes. */}
              <ChangesView
                key={selectedSession.sessionId}
                cwd={selectedSession.cwd}
                // The newest prompt's snapshot and its turn's closing one: the
                // Turn sub-tab is that pair, and the same two ids light the
                // toggle's git glyph.
                baseline={baseline}
                head={head}
                active={panelShown && activeTab === "changes"}
                revision={revision}
                onUndone={() => setRepoRevision((n) => n + 1)}
              />
            </TabBody>
            <TabBody active={activeTab === "browser"}>
              <BrowserPane
                sessionId={selectedSession.sessionId}
                active={panelShown && activeTab === "browser"}
              />
            </TabBody>
            <TabBody active={activeTab === "files"}>
              {/* Keyed by session so the expanded tree resets with it. The tab
                  strip does not: its store is per session and outlives the
                  remount, so what comes back is that session's own files. */}
              <FilesView
                key={selectedSession.sessionId}
                sessionId={selectedSession.sessionId}
                cwd={selectedSession.cwd}
                active={panelShown && activeTab === "files"}
                revision={revision}
              />
            </TabBody>
            <TabBody active={hasTodoTab && activeTab === "todo"}>
              <TodoPanel plan={todoPlan} live={busy} />
            </TabBody>
            <TabBody active={hasPrTab && activeTab === "pr"}>
              <PrPanel
                branch={prBranch}
                cwd={selectedSession?.cwd ?? ""}
                {...pullRequests}
              />
            </TabBody>
            <TabBody active={hasDocsTab && activeTab === "docs"}>
              <DocsPanel
                sessionId={selectedSessionId}
                active={panelShown && activeTab === "docs"}
              />
            </TabBody>
            <TabBody active={hasIssueTab && activeTab === "issue"}>
              <IssuePanel
                sessionId={selectedSessionId}
                issues={sessionIssues}
                onUnlink={unlinkIssue}
                {...issueData}
              />
            </TabBody>
          </RightPanel>
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
        // short: this one named the issues and pull-request pages and not the
        // plugins one, so that page shipped with a composer under it — offering to
        // send into a session the reader had left. Safe to unmount: the draft, the
        // attachments and the fan-out set are module-level stores precisely
        // because the composer already unmounts crossing the empty state.
        //
        // A subagent view hides it too, and for a nearer reason: a delegated child
        // cannot be prompted at all — the agent publishes no way to send into one —
        // so a composer under it would be the one control on screen that lies
        // about what it does. The way back is the arrow in the header.
        pageOpen || subagentView ? null : (
        <ChatInput
          onSend={handleSendMsg}
          commands={slashCommands}
          commandsLoading={slashCommandsLoading}
          cwd={composerCwd}
          onStop={handleInterrupt}
          // Above the card and outside it: the strip names live work, and the
          // card's blur backdrops everything inside it — the same trap that
          // sends the pickers to the wrapper. Unmounted idle, so the composer
          // never moves for it.
          followup={
            <FollowupStrip
              runs={liveRuns}
              plan={stripPlan}
              live={busy}
              onOpenRun={openSubagentRun}
              onOpenPanel={openFirstSubagent}
              onOpenPlan={openTodoPanel}
            />
          }
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
          isNewTask={!selectedSession}
          target={composerTarget}
          // Walked by ↑/↓ in an empty box. The transcript is the history — no
          // second store to keep in step, and a resumed session arrives with its
          // prompts already in it.
          history={promptHistory}
          issuesConnected={issuesConnected}
          modelTakesImages={modelTakesImages}
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
              />
            ) : undefined
          }
          archived={selectedSession?.archived ?? false}
          onUnarchive={() =>
            selectedSessionId &&
            void handleSetSessionFlags(selectedSessionId, { archived: false })
          }
          onRemoveWorktree={
            selectedSessionId && selectedSession?.worktreeName
              ? () =>
                  void askAboutWorktree(
                    selectedSessionId,
                    selectedSession.worktreeName as string,
                    selectedSession.title,
                    "dialog",
                  )
              : undefined
          }
          // The peek and the strip want the same 4px band above the card, and
          // the peek's whole affordance is being *tucked behind* the composer:
          // two button tops showing above a strip is neither — it reads as
          // debris stuck to the strip's own top edge. So while work is live the
          // band is status, and the moment it clears the peek is back. Handing
          // work back mid-turn is queuing it anyway.
          handoff={
            stripShown ? null : (
              <HandoffRow
                actions={handoffActions(workStatus, sessionHasPr)}
                // Straight out as a prompt, exactly as if it had been typed. A
                // turn already running queues it, like any other send.
                onSend={(prompt) => void handleSendMsg(prompt)}
                disabled={!selectedSessionId}
              />
            )
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
          permission={
            offersPermissionModes(harness) ? (
              <PermissionSelector
                harness={harness}
                value={permissionMode}
                onChange={setPermissionMode}
              />
            ) : null
          }
          // **Placed by the composer, not the toolbar.** The reading belongs on the
          // row under the text, and which row that is changes with the state: the
          // toolbar is above the input before a session exists and under it after.
          // Keyed by session, because a reading belongs to one.
          meter={
            <ContextMeter
              key={selectedSessionId ?? "new"}
              sessionId={selectedSessionId}
              used={contextUsage?.used ?? 0}
              max={contextUsage?.max ?? 0}
              costUsd={contextUsage?.costUsd ?? null}
              events={selectedSession?.events ?? EMPTY_EVENTS}
              stored={selectedSession?.contextReading ?? null}
            />
          }
          toolbar={
            <ComposerToolbar
              harness={harness}
              models={models}
              modelId={modelId}
              effort={effort}
              fast={fast}
              onFastChange={setFast}
              fastNote={fastNote}
              onModelChange={handleModelChange}
              onRefreshModels={refreshModels}
              onOpenProviderSettings={openProviderSettings}
              loadingModels={loadingModels}
              projects={spaceProjects}
              projectPath={projectPath}
              onSelectProject={handleSelectProject}
              onAttachProject={handleAttachProject}
              repos={repos}
              repoPath={repoPath}
              onSelectRepo={setRepoPath}
              atWorkspaceRoot={atWorkspaceRoot}
              branches={branches}
              branch={branch}
              onSelectBranch={handleSelectBranch}
              pendingBranch={pendingBranch}
              onConfirmBranchSwitch={(stash) =>
                pendingBranch && runCheckout(pendingBranch, stash)
              }
              onCancelBranchSwitch={() => setPendingBranch(null)}
              agentName={agentName}
              onAgentChange={setAgentName}
              useWorktree={useWorktree}
              onToggleWorktree={() => setUseWorktree((v) => !v)}
              onAttach={() => void pickAttachments(selectedSessionId)}
              sessionId={selectedSessionId}
              isNewSession={!selectedSessionId}
            />
          }
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
      {pageSeen("search") && (
      <TabBody active={searchPageOpen}>
        <Suspense fallback={null}>
          <SearchView
            active={searchPageOpen}
            sessions={visibleSessions}
            // The selected session's own checkout, since a hit opens there.
            cwd={selectedSession?.cwd ?? null}
            onClose={() => setPage("none")}
            // A row is somewhere to go, and every route there closes the page: a
            // session or a message opens that session, a file or a line opens in the
            // one already on screen — which needs the page out of the way to be seen.
            onOpen={(hit) => {
              if (hit.kind === "session" || hit.kind === "message") {
                goToSession(() => void handleSelectSessionIndexItem(hit.sessionId));
                return;
              }
              goToSession(() => openInFiles(selectedSessionId, hit.path, hit.kind === "code" ? hit.line : undefined));
            }}
          />
        </Suspense>
      </TabBody>
      )}

      {pageSeen("prs") && (
      <TabBody active={prsOpen}>
        <Suspense fallback={null}>
          <PrsView
            tabs={<InboxTabs current="prs" counts={inbox.counts} onSelect={selectInboxPage} />}
            cwds={prsCwds}
            active={prsOpen}
            picked={activePr}
            onPick={openPr}
            onClose={() => setPage("none")}
            refreshRef={prsRefreshRef}
            pickedRun={pickedRun}
            onPickRun={setPickedRun}
          />
        </Suspense>
      </TabBody>
      )}

      {pageSeen("issues") && (
      <TabBody active={issuesOpen}>
        <Suspense fallback={null}>
          <IssuesView
            tabs={<InboxTabs current="issues" counts={inbox.counts} onSelect={selectInboxPage} />}
            active={issuesOpen}
            picked={pickedIssue?.identifier ?? null}
            onPick={setPickedIssue}
            onWorkOn={workOnIssue}
            refreshRef={issuesRefreshRef}
            connected={issuesConnected}
            onConnect={integrations.connect}
            connecting={integrations.busy}
            connectError={integrations.error}
          />
        </Suspense>
      </TabBody>
      )}

      {/* Ahead of the two it draws from: it is the question neither of them can
          answer alone, and a row click goes to whichever owns the item. */}
      {pageSeen("inbox") && (
      <TabBody active={inboxOpen}>
        <Suspense fallback={null}>
          <InboxView
            tabs={<InboxTabs current="inbox" counts={inbox.counts} onSelect={selectInboxPage} />}
            items={inbox.items}
            notes={inbox.notes}
            reading={inbox.reading}
            multiRepo={inbox.multiRepo}
            refreshing={inbox.refreshing}
            onRefresh={inbox.refresh}
            // A row click goes to whichever page owns the item, with it open: this
            // list reads both trackers, and neither of the two can be acted on from
            // here. The tab row above is how the reader comes back.
            onOpen={(item) =>
              item.kind === "pr"
                ? (setPage("prs"), openPr(item.row))
                : (setPage("issues"), setPickedIssue(item.row))
            }
          />
        </Suspense>
      </TabBody>
      )}

      {pageSeen("plugins") && (
      <TabBody active={pluginsOpen}>
        <Suspense fallback={null}>
          <PluginsView
            active={pluginsOpen}
            tab={pluginsTab}
            onTab={setPluginsTab}
            onClose={() => setPage("none")}
            refreshRef={pluginsRefreshRef}
          />
        </Suspense>
      </TabBody>
      )}

      {/* Hidden rather than unmounted, the same bargain the right panel's tabs
          make: the transcript keeps its scroll position and its highlighted
          diffs across a trip into a page and back. */}
      <TabBody active={!pageOpen}>
      {/* **The subagent's own conversation, when one is open.** A second
          `TabBody` rather than a branch inside `Chat`, for the reason above: the
          transcript has a scroll position and a window of backfilled turns to
          keep, and swapping the two inside one component would lose both. The
          column shows one or the other, and each names itself in the window
          header. */}
      <TabBody active={subagentView !== null}>
        {selectedSession && subagentView && (openSubagentMember || openSubagentFallback) ? (
          <SubagentChat
            // Keyed by the pair, so switching subagents resets the reading rather
            // than leaving the last child's turns under the new one's name.
            key={openSubagentKey ?? ""}
            // The parent, not the child: a child has no `cwd` and no project of
            // its own, and every read behind this view is addressed through the
            // session that delegated it.
            parent={selectedSession}
            memberSessionId={subagentView.memberSessionId}
            events={openSubagentEvents}
            live={openSubagentLive}
            brief={openSubagentBrief}
            crowded={!collapsed && panelShown}
            onOpenSession={(id) => void handleSelectSessionIndexItem(id)}
          />
        ) : (
          // Nothing has resolved yet: the selection the row was clicked under is
          // still landing, or the session's own transcript has not been read. One
          // sentence rather than an empty view, since "nothing was recorded" is
          // an answer this does not have yet.
          <p className="px-6 py-6 text-chat text-muted-foreground/70">
            Reading what it is working on…
          </p>
        )}
      </TabBody>

      <TabBody active={subagentView === null}>
      {activeGroup ? (
        <SplitView
          columns={paneColumns}
          focusedId={selectedSessionId}
          paneState={paneState}
          groups={spaceGroups}
          onFocus={(id) => void handleSelectSessionIndexItem(id)}
          onClose={closeSessionPane}
          // `chatShown`, not `!pageOpen`: the pane at its wide size covers this
          // column too, and a transcript that is not on screen must not follow
          // the stream — a `scrollTop` written against a `display: none` element
          // lands at zero, which is what the reader would come back to. A subagent
          // view over it is the third way this column stops being on screen.
          active={chatShown && subagentView === null}
          chat={{
            onOpenSubagent: openSubagentRun,
            onOpenSession: (id) => void handleSelectSessionIndexItem(id),
            onSendNow: handleSendNow,
            onOpenSubagents: canOpenSubagent ? openFirstSubagent : undefined,
            onRespondPermission: handleRespondPermission,
            onAnswerQuestions: handleAnswerQuestions,
            onCancelQuestion: handleCancelQuestion,
          }}
        />
      ) : (
      // The single view is one drop target: a row let go here opens beside
      // the selected session, on whichever side it was let go.
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        {...{ [DROP_ATTR]: selectedSessionId ?? undefined }}
      >
      <Chat
        session={selectedSession}
        streamingBlock={
          selectedSessionId ? streamingContentBlock[selectedSessionId] ?? null : null
        }
        onOpenSubagent={openSubagentRun}
        onOpenSession={(id) => void handleSelectSessionIndexItem(id)}
        onOpenSubagents={canOpenSubagent ? openFirstSubagent : undefined}
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
        working={working}
        crowded={!collapsed && (panelShown || (pageOpen && !!pickedIssue))}
        active={chatShown && subagentView === null}
      />
      {singleDrop && <DropZone region={singleDrop.region} label={singleDrop.label} />}
      </div>
      )}
      </TabBody>
      </TabBody>
      </RenderErrorBoundary>
    </AppShell>
    {/* Outside `AppShell` on purpose: it is fixed to the window rather than
        placed in the layout, and the shell has no slot that isn't a pane. */}
    <NoticeStack
      onSelect={(id) => goToSession(() => void handleSelectSessionIndexItem(id))}
      // The session and the pane both, since the card is about something the
      // transcript does not show. The pick is written the same way
      // `usePullRequest`'s `onOpened` writes it — `activeTab` honours a
      // standing pick, and opening the pane stores "changes" on its own.
      onOpenPr={(id) => {
        void handleSelectSessionIndexItem(id);
        setPanelTab("pr", id);
        setPanelOpen(true, id);
      }}
      onDeleteWorktree={(id) => removeWorktree(id)}
    />
    <SlowRequestToast />
    {paletteOpen && (
    <Suspense fallback={null}>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={(open) => {
          setPaletteOpen(open);
          // The box is a fresh question every time — the palette clears its own
          // copy on the way in, and this one has to go with it or the next open
          // searches words the reader has already forgotten typing.
          if (!open) setPaletteQuery("");
        }}
        items={paletteItems}
        onQueryChange={setPaletteQuery}
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
          if (!next) {
            setSettingsTab("appearance");
            setNamingSpace(false);
          }
        }}
        initialTab={settingsTab}
        // Every project, not the active space's: this is where a project is filed
        // into one, and a list narrowed by the space would hide exactly the rows
        // somebody opens it to move.
        projects={projects}
        spaces={spaces}
        startNamingSpace={namingSpace}
        onSetProjectSpace={setProjectSpace}
        onRemoveProject={handleRemoveProject}
        onCreateSpace={createSpace}
        onRenameSpace={renameSpace}
        onRemoveSpace={removeSpace}
        onMoveSpace={moveSpaceBy}
        integrations={integrations}
        updateStatus={updateStatus}
        updateManual={updateManual}
        updateBlocked={anyRunning}
        onCheckUpdates={checkForUpdates}
        onInstallUpdate={installUpdate}
        updateChannel={updateChannel}
        onUpdateChannelChange={setUpdateChannel}
        // A provider changed, so the picker's list is stale — the agent is what
        // answers it, and it just answered something else. The settings screen's
        // model switches are drawn from that same list, which is why it is handed
        // down rather than read again there.
        models={models}
        loadingModels={loadingModels}
        onProvidersChanged={() => void refreshModels()}
      />
    </Suspense>
    )}
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
