import { useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import CommitMessage from "@/components/changes/CommitMessage";
import DiffPane from "@/components/changes/DiffPane";
import FileList from "@/components/changes/FileList";
import HistoryList from "@/components/changes/HistoryList";
import ShortcutKeys from "@/components/ShortcutKeys";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChanges } from "@/hooks/useChanges";
import { useHotkey } from "@/hooks/useHotkey";
import { useCommitLog, useHeadTree } from "@/hooks/useRepo";
import { commitBase, defaultSubTab, type SubTab } from "@/lib/commit";
import { cn } from "@/lib/utils";
import type { ChangedFile, Commit, UndoReport } from "@/types/events";

const SUB_TABS = [
  // The turn first, and it is the one the pane opens onto: the toggle's git
  // glyph says the last prompt touched files, and this is the tab that answers
  // it. Read off the snapshot pair the prompt took rather than off the
  // repository, which is what makes it one turn's work and not the tree's.
  { value: "turn", label: "Turn" },
  // "Uncommitted" rather than "Changes", for the same reason: it says which
  // range it covers, where the parent's name says nothing about what sets it
  // apart from the tab beside it.
  { value: "uncommitted", label: "Uncommitted" },
  // Between the two, because it is between them in what it answers: this
  // branch's own commits are narrower than the whole of HEAD's history and
  // wider than what has not been committed yet.
  { value: "branch", label: "Branch" },
  { value: "history", label: "History" },
] as const satisfies readonly { value: SubTab; label: string }[];

/// Holds identity for the two lists' `files` when a read hasn't landed, so the
/// selection below doesn't churn on a fresh array every render.
const NO_FILES: readonly ChangedFile[] = [];

/// What an undo did, in the reader's words. Counts rather than a list of paths:
/// the list is the pane right beside this, and a second copy of it would be the
/// copy that goes stale.
function undoSummary(report: UndoReport): string {
  const bits = [
    report.restored ? `${report.restored} file${report.restored === 1 ? "" : "s"} put back` : "",
    report.deleted ? `${report.deleted} added by the turn removed` : "",
  ].filter(Boolean);
  return bits.length ? `Undone — ${bits.join(", ")}.` : "Nothing to undo.";
}

/// The session's repository: what the last turn changed, what is uncommitted,
/// what has been committed, and the diff for whichever file is selected.
///
/// Read-only, deliberately. The conversation next door is where work gets made
/// and committed — a second place to write commits would be a second way to do
/// the thing the reader is already asking the agent for.
///
/// **The Turn tab is the newest thing here** and the reason this pane opens
/// onto it. The other three read off HEAD, the branch and the log, which is a
/// wider question than one turn. Everything runs against `cwd` rather than the
/// project root — a worktree session has its own tree.
export default function ChangesView({
  cwd,
  baseline,
  head,
  active,
  revision,
  onUndone,
}: {
  cwd: string;
  /// The tree the newest prompt snapshotted, or null where this session has
  /// none — no prompt sent yet, or one recorded by a build that took none.
  baseline: string | null;
  /// That turn's closing snapshot, or null while it is still running, which
  /// diffs against the tree as it stands.
  head: string | null;
  /// False while another view is showing. The component stays mounted so its
  /// selection and its rendered diffs survive, but a hidden view must not keep
  /// snapshotting the working tree on every event.
  active: boolean;
  revision: string;
  /// An undo landed, so the working tree is not what the last read saw. The app
  /// bumps its revision and every view re-reads — this one included, which is
  /// why nothing here refreshes itself.
  onUndone?: () => void;
}) {
  // `null` is "the reader never picked", the rule `panelTab` reads by: a hand
  // pick wins from there on, and until there is one the derived default stands.
  // Storing `"uncommitted"` as the initial value would make a fresh arrival
  // indistinguishable from a reader who chose it, so nothing else could ever
  // lead.
  const [subTabPick, setSubTabPick] = useState<SubTab | null>(null);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [branchSha, setBranchSha] = useState<string | null>(null);
  const [turnPath, setTurnPath] = useState<string | null>(null);
  const [workingPath, setWorkingPath] = useState<string | null>(null);
  // A path each, not one shared between the two commit tabs. Switching tabs by
  // the row moves the open commit without either list's `onToggle` running, so
  // a single path followed the reader across and opened a file of the same name
  // in the other tab's commit — which is the auto-selection rule quietly not
  // happening.
  const [commitPath, setCommitPath] = useState<string | null>(null);
  const [branchPath, setBranchPath] = useState<string | null>(null);

  const headTree = useHeadTree(cwd, revision, active);

  // Every read runs on `active` alone rather than on the tab it belongs to,
  // because the default below reads them all: gating them on the tab they
  // choose is circular, and it flipped the row twice on arrival before it
  // settled. It also makes the counts honest from every tab, which they were
  // not before — a read behind them only ran while its own tab was showing. The
  // `active` gate stays on every one either way: a hidden view must still not
  // snapshot the working tree on every event.
  //
  // The turn's range is the snapshot the newest prompt took against the tree as
  // the turn closed, which is the pair the toggle's glyph is read off. The
  // uncommitted range is HEAD's tree against the working tree as it stands,
  // which `changes_since` snapshots to answer — a commit moves HEAD, so that
  // key rolls onto the new baseline on its own and nothing invalidates a cache.
  const turn = useChanges(cwd, baseline, head, revision, active);
  const working = useChanges(cwd, headTree.tree, null, revision, active);
  const branchLog = useCommitLog(cwd, revision, active, "log_branch_commits");

  const turnFiles = turn.changes?.files ?? NO_FILES;
  const workingFiles = working.changes?.files ?? NO_FILES;

  const derived = defaultSubTab({
    hasTurn: turnFiles.length > 0,
    hasUncommitted: workingFiles.length > 0,
    settled: !!working.changes,
    hasBranchCommits: branchLog.commits.length > 0,
  });

  // Taken **once**, when every read has first answered, and held from there.
  // The rule picks where the row opens, not where it lives: left deriving on
  // every render it moves under the reader whenever the answer changes — the
  // agent writing a file mid-turn would step them off the diff they were
  // reading and onto Uncommitted. Every read has to have landed before it can
  // be taken at all, or whichever answers first decides on the others' behalf.
  //
  // `turnReady` is the third of those and the least obvious: with no baseline
  // the turn read never runs at all, so a read still out and nothing to read
  // have to be told apart here — otherwise the row is latched onto whatever the
  // other two say before the turn could claim it.
  const turnReady = !baseline || !!turn.changes;
  if (subTabPick === null && turnReady && working.changes && branchLog.settled) {
    setSubTabPick(derived);
  }

  const subTab = subTabPick ?? derived;

  // A different directory is a different repository, so the tab taken for the
  // old one says nothing about this one.
  const [seeded, setSeeded] = useState(cwd);
  if (seeded !== cwd) {
    setSeeded(cwd);
    setSubTabPick(null);
  }

  // History keeps its gate. It is the expensive read — the whole of HEAD's
  // history behind it, however long that is — and nothing in the rule above
  // asks it anything.
  const log = useCommitLog(cwd, revision, active && subTab === "history", "log_commits");

  // Derived from a sha the way `pick` derives the file below, so a commit that
  // pages out from under the list cannot leave the pane pointing at nothing.
  // Falling back to the newest is what opens this tab on a diff rather than on
  // an empty frame.
  const branchCommit =
    branchLog.commits.find((c) => c.sha === branchSha) ?? branchLog.commits[0] ?? null;

  // One commit is open in the pane at a time, whichever tab opened it, so its
  // read and its file selection are shared rather than written out twice.
  const openCommit = subTab === "branch" ? branchCommit : subTab === "history" ? commit : null;

  // A commit's own range is two fixed ids, so this is read once and cached
  // forever — reopening one costs nothing after the first time.
  const commitChanges = useChanges(
    cwd,
    openCommit ? commitBase(openCommit) : null,
    openCommit?.sha ?? null,
    "",
    active && !!openCommit,
  );

  const commitFiles = commitChanges.changes?.files ?? NO_FILES;

  // Derived rather than stored, so a file that stops being changed cannot leave
  // the pane pointing at nothing. First by position when there is no pick: the
  // diff has its own pane here, so opening one hides nothing the way it would
  // in the turn panel's single column.
  const pick = (files: readonly ChangedFile[], path: string | null) =>
    files.find((f) => f.path === path) ?? files[0] ?? null;

  const selectedTurnFile = pick(turnFiles, turnPath);
  const selectedWorking = pick(workingFiles, workingPath);
  const selectedCommitFile = pick(commitFiles, subTab === "branch" ? branchPath : commitPath);

  const showing = subTab === "turn" ? turn : subTab === "uncommitted" ? working : commitChanges;
  const selectedFile =
    subTab === "turn"
      ? selectedTurnFile
      : subTab === "uncommitted"
        ? selectedWorking
        : selectedCommitFile;

  /// What the Turn tab says where a list would be. Three states and the reader
  /// is looking at one of them whichever it is: a session with no prompt behind
  /// it has no pair to diff, an unanswered read has no answer, and a turn that
  /// only read files has an empty list rather than a missing one.
  const turnEmpty = !baseline
    ? "Nothing sent in this session yet."
    : turn.changes
      ? "No files changed this turn."
      : "Reading the turn…";

  /// The count beside each sub-tab, read off the list it labels. Zero draws
  /// nothing, so a tab whose read has not landed reads as a tab.
  const subTabCounts: Partial<Record<SubTab, number>> = {
    turn: turnFiles.length,
    uncommitted: workingFiles.length,
  };

  /// The undo control's three states in one value — asking, running, neither —
  /// so "confirming while already running" is not a state this can be in.
  const [undo, setUndo] = useState<"idle" | "confirm" | "working">("idle");
  /// What the last attempt said, or null. Held as a sentence rather than a
  /// report: a refusal and a success are both one line to the reader, and the
  /// numbers a success carries are already in the list above it.
  const [said, setSaid] = useState<{ text: string; error?: boolean } | null>(null);

  /// It describes what just happened to *this* tab, so it goes when the reader
  /// moves. Adjusted during render rather than in an effect, the pattern
  /// `seeded` above already uses.
  const [saidFor, setSaidFor] = useState<SubTab>(subTab);
  if (saidFor !== subTab) {
    setSaidFor(subTab);
    setSaid(null);
  }

  /// A finished turn with both snapshots is the only thing with something to put
  /// back, and the control is the Turn tab's alone: it names a range, and that
  /// is the range.
  const canUndo = subTab === "turn" && !!baseline && !!head && turnFiles.length > 0;

  const runUndo = async () => {
    if (!baseline || !head) return;
    setUndo("working");
    try {
      const report = await invoke<UndoReport>("undo_turn", { cwd, baseline, head });
      setSaid({ text: undoSummary(report) });
      // The turn's own diff is history and does not move; what moved is the
      // working tree, so the app is asked to let every view re-read it — this
      // one included, which is why nothing here refreshes itself.
      onUndone?.();
    } catch (e) {
      // The refusal is the interesting failure and it is a whole sentence, so it
      // is shown as written rather than reworded here.
      setSaid({ text: String(e), error: true });
    }
    setUndo("idle");
  };

  // ⌘⇧← / ⌘⇧→ step this row, the same shape ⌘⇧↑/↓ steps the session list — the
  // arrow points at the tab, so a fourth sub-tab would need no fourth binding.
  // Not ⌘1/⌘2, which the view row above already spends, and not ⌘⇧[ /], which
  // belongs to the right panel and would mean two different rows at once.
  //
  // Clamped rather than wrapped: wrapping would make ← from the first tab land
  // on the last, which is the long way round a row this short.
  //
  // Registered only while this view is showing. It stays mounted when it isn't,
  // and `useHotkey` claims every chord it matches, so leaving it bound would
  // take ⌘⇧← from the composer, where it selects to the start of the line.
  const stepSubTab = (delta: number) => {
    const next = SUB_TABS[SUB_TABS.findIndex((t) => t.value === subTab) + delta];
    if (next) setSubTabPick(next.value);
  };
  //
  // Given up while a text field has focus, which `enabled` cannot express: the
  // right panel sits beside this view, so a doc open in edit mode over there is
  // a textarea on screen at the same time as this row — and ⌘⇧← is
  // select-to-line-start in it.
  const chord = { enabled: active, skipInTextField: true };
  useHotkey("subtab.prev", () => stepSubTab(-1), chord);
  useHotkey("subtab.next", () => stepSubTab(1), chord);

  // A directory that isn't a repository has nothing to diff. Said plainly
  // rather than drawn as an empty change list, which would read as a clean
  // tree — but only once the read has actually answered. Before that `null` is
  // just "not asked yet", and this view paints before the first read lands, so
  // testing the id alone announced every real repository as a plain directory
  // for a frame or two. A repository with no commit yet is not this case: it
  // answers with the empty tree, so its files list as additions.
  if (headTree.settled && headTree.tree === null && !working.changes) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-ui text-muted-foreground">
        This session is not in a git repository.
      </div>
    );
  }

  return (
    // No top border: the pane's own tab row above already carries a bottom
    // rule, and a second one here would draw a two-pixel line between them.
    <div className="flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        {/* `px-1` against the right panel's `px-2`, because the tabs here have
            a list under them rather than a panel body: the button's own `px-2`
            lands its label at 12px, level with the filenames below it. */}
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1">
          {/* The question takes the row rather than a dialog: it is one
              decision about the tab the reader is looking at, and a modal over
              a pane this narrow covers the very thing being decided. The tabs
              come back either way. */}
          {undo === "idle" ? null : (
            <>
              <span className="truncate px-2 text-ui text-muted-foreground">
                Undo this turn?
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setUndo("idle")}
                  disabled={undo === "working"}
                >
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => void runUndo()}
                  disabled={undo === "working"}
                >
                  {undo === "working" ? "Undoing…" : "Undo"}
                </Button>
              </div>
            </>
          )}
          {undo === "idle" &&
            SUB_TABS.map(({ value, label }) => (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setSubTabPick(value)}
                  className={cn(
                    "rounded-md px-2 py-1 text-ui transition-colors",
                    subTab === value
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {!!subTabCounts[value] && (
                    <span className="ml-1 text-muted-foreground">{subTabCounts[value]}</span>
                  )}
                </button>
              </TooltipTrigger>
              {/* Keycaps alone, like the view row above: the name is already on
                  the button, and one chord steps the row.

                  The same cap on every tab, deliberately. Narrowing it to the
                  reachable direction per tab made a row of three say three
                  different things about one binding, so a reader hovering two
                  tabs had to work out they were the same shortcut. It names the
                  chord, not the trip from the tab under the cursor. */}
              <TooltipContent side="bottom" className="px-1.5">
                <ShortcutKeys ids={["subtab.prev", "subtab.next"]} />
              </TooltipContent>
            </Tooltip>
          ))}
          {canUndo && undo === "idle" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto shrink-0 text-muted-foreground/60 hover:text-muted-foreground"
                  onClick={() => setUndo("confirm")}
                  aria-label="Undo this turn"
                >
                  <Undo2 />
                </Button>
              </TooltipTrigger>
              {/* A real tooltip and not a `title`, the app's rule for chrome —
                  and it is where the refusal's sentence would otherwise have to
                  live, which is why the refusal is a line of its own below. */}
              <TooltipContent side="bottom">
                Undo this turn
                <span className="text-muted-foreground"> · puts its files back</span>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Under the row rather than in it: the tabs stay where the reader left
            them, and a sentence about what just happened is not a tab. */}
        {said && (
          <p
            className={cn(
              "shrink-0 border-b border-border px-3 py-2 text-ui",
              said.error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {said.text}
          </p>
        )}

        {subTab === "turn" ? (
          turnFiles.length === 0 ? (
            <p className="min-h-0 flex-1 px-3 py-6 text-ui text-muted-foreground">{turnEmpty}</p>
          ) : (
            <FileList
              files={turnFiles}
              selected={selectedTurnFile?.path ?? null}
              onSelect={setTurnPath}
              className="min-h-0 flex-1 overflow-y-auto"
            />
          )
        ) : subTab === "uncommitted" ? (
          workingFiles.length === 0 ? (
            <p className="min-h-0 flex-1 px-3 py-6 text-ui text-muted-foreground">
              {working.changes ? "No uncommitted changes." : "Reading the working tree…"}
            </p>
          ) : (
            <FileList
              files={workingFiles}
              selected={selectedWorking?.path ?? null}
              onSelect={setWorkingPath}
              className="min-h-0 flex-1 overflow-y-auto"
            />
          )
        ) : subTab === "branch" ? (
          <HistoryList
            commits={branchLog.commits}
            selected={branchCommit?.sha ?? null}
            // No closing here, unlike History. Something is always open on this
            // tab, because closing it is exactly the empty pane the tab exists
            // to replace.
            onToggle={(next) => {
              setBranchSha(next.sha);
              setBranchPath(null);
            }}
            files={commitFiles}
            selectedFile={selectedCommitFile?.path ?? null}
            onSelectFile={setBranchPath}
            hasMore={branchLog.hasMore}
            onLoadMore={branchLog.loadMore}
            loading={branchLog.loading}
            error={branchLog.error}
            empty="This branch has no commits of its own yet."
          />
        ) : (
          <HistoryList
            commits={log.commits}
            selected={commit?.sha ?? null}
            // Clicking the open commit closes it, which is also the only way
            // back to a list with nothing expanded in it.
            onToggle={(next) => {
              setCommit((prev) => (prev?.sha === next.sha ? null : next));
              setCommitPath(null);
            }}
            files={commitFiles}
            selectedFile={selectedCommitFile?.path ?? null}
            onSelectFile={setCommitPath}
            hasMore={log.hasMore}
            onLoadMore={log.loadMore}
            loading={log.loading}
            error={log.error}
          />
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Keyed on the sha so opening another commit arrives collapsed: the
            expanded state belongs to the message being read, not to the pane.
            The message belongs to whichever commit is open, whichever of the
            two tabs opened it. */}
        {openCommit && <CommitMessage key={openCommit.sha} commit={openCommit} />}

        <DiffPane
          cwd={cwd}
          base={showing.changes?.base ?? ""}
          head={showing.changes?.head ?? ""}
          file={showing.changes ? selectedFile : null}
          empty={
            subTab === "turn" && turnFiles.length === 0
              ? turnEmpty
              : subTab === "history" && !commit
                ? "Open a commit to see what it changed."
                : subTab === "branch" && !branchCommit
                  ? "This branch has no commits of its own yet."
                  : "Select a file to see what changed."
          }
        />
      </div>
    </div>
  );
}
