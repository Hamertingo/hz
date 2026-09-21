import {
  ArrowUpDown,
  CalendarArrowDown,
  CalendarArrowUp,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  FolderGit2,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Layers,
  ListChecks,
  ListFilter,
  Maximize2,
  Minimize2,
  PenLine,
  RefreshCw,
  Search,
  Tag,
  TriangleAlert,
  UserLock,
  UserRound,
} from "lucide-react";
import {
  useMemo,
  useState,
  type ComponentType,
  type MutableRefObject,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import Avatar from "@/components/Avatar";
import { MetaLine } from "@/components/MetaLine";
import { LabelChip, LabelDot } from "@/components/LabelChip";
import PrPanel from "@/components/PrPanel";
import PrStateIcon from "@/components/PrStateIcon";
import Tab from "@/components/Tab";
import RunsView from "@/components/RunsView";
import { TabButton, TabRow } from "@/components/TabRow";
import { Button, buttonVariants } from "@/components/ui/button";
import { prKey, usePrList, type PrRow } from "@/hooks/usePrList";
import { useWorkflowRuns, type RunRow } from "@/hooks/useWorkflowRuns";
import { usePullRequest } from "@/hooks/usePullRequest";
import { loginAvatar } from "@/lib/avatar";
import { relativeTime } from "@/lib/format";
import { prUnavailableText } from "@/lib/unavailable";
import {
  ANY,
  authorFacets,
  DEFAULT_FILTERS,
  groupPrs,
  labelFacets,
  SORT_LABELS,
  sortPrs,
  visiblePrs,
  type AuthorFacet,
  type LabelFacet,
  type PrFilters,
  type PrInvolvement,
  type PrSort,
} from "@/lib/prList";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PrListItem, PrListState } from "@/types/events";

/// The repository's pull requests, all of them.
///
/// **The page and the session's tab answer different questions.** The tab is
/// "where did *this branch's* work land" — usually one row, and it leads with
/// readiness so the reader can merge and move on. This is "what is open here",
/// which is the question a reader has when the branch they are on has no pull
/// request at all, or when they want to know what else is in flight, or when
/// somebody has asked them for a review.
///
/// **Every repository the reader is working in, in one list.** One `gh` call per
/// repository, run in parallel and merged here — the calls are short-lived
/// processes rather than agent children, so six repositories cost the slowest of
/// the six. A repository that could not be read is a sentence under the rows
/// rather than the whole page: five of six is the ordinary case, not an error.
///
/// Rows carry the repository they came from, and the label is drawn only where
/// more than one is listed — two checkouts of one project each have their own
/// `feature` branch, so a title alone cannot say which one a row is.
export default function PrsView({
  tabs,
  cwds,
  active,
  picked,
  onPick,
  onClose,
  refreshRef,
  pickedRun,
  onPickRun,
}: {
  /// The inbox's source row, drawn at the top of this page rather than only on
  /// the inbox: all three wear it, so a reader switches between them without
  /// going back through the sidebar. Taken as a node, the seam `RightPanel` uses
  /// for its own tab strip — the row is the shell's, its place is this page's.
  tabs?: ReactNode;
  /// The repositories to list, in the order the app knows them.
  cwds: string[];
  active: boolean;
  /// The row whose detail the right pane is showing, held by `App` so the pane
  /// and the list cannot disagree about which one is picked.
  picked: PrRow | null;
  onPick: (item: PrRow) => void;
  onClose: () => void;
  /// The page's own refresh, handed up so ⌘R and a write made in the detail
  /// pane can reach it — the same handle the issues page hands up, for the same
  /// reason: the page owns the read and the rest of the app only presses a
  /// button.
  refreshRef?: MutableRefObject<(() => void) | null>;
  /// The run whose detail the right pane is showing, and the pick that sets it.
  /// Held by `App` for the pane's reason: the pane is drawn beside this page,
  /// so a pick this page kept to itself could not open it.
  pickedRun: RunRow | null;
  onPickRun: (run: RunRow | null) => void;
}) {
  const [filters, setFilters] = useState<PrFilters>(DEFAULT_FILTERS);

  /// **Two lists, one page, and the sub-tab is which of them has the frame.**
  /// Pull requests is where the page opens and the reason it exists; Actions is
  /// the same repository's CI, which is the other question a branch raises.
  const [section, setSection] = useState<"prs" | "actions">("prs");
  /// Which branch the runs are asked about. `null` is all of them, and it is the
  /// one facet that reaches the host: `gh run list --branch` is server-side.
  const [runBranch, setRunBranch] = useState<string | null>(null);

  /// **Read while either sub-tab is up, not only while Actions is.** The count on
  /// the row comes out of it, and a count meaning "not read yet" is worse than no
  /// count at all; it also makes pressing the tab instant, since the read the
  /// reader is about to want has already been made. One `gh run list` per
  /// repository, trusted for a minute and polled only while something is in
  /// flight — see [useWorkflowRuns](../hooks/useWorkflowRuns.ts).
  const runs = useWorkflowRuns(cwds, active, runBranch);
  const { items, viewer, error, failed, loading, refresh, invalidate } = usePrList(
    cwds,
    // Paused while the runs are the body on screen: a listing nobody is looking
    // at is a spawn per keystroke elsewhere, and the rows stay drawn from the
    // cache either way.
    active && section === "prs",
    filters.state,
    filters.query,
  );

  /// The row both bodies draw, with the counts the two reads give it.
  const subTabs = (
    <TabRow>
      <TabButton
        active={section === "prs"}
        label="Pull requests"
        count={items.length}
        onClick={() => {
          setSection("prs");
          onPickRun(null);
        }}
      />
      <TabButton
        active={section === "actions"}
        label="Actions"
        count={runs.runs.length}
        onClick={() => setSection("actions")}
      />
    </TabRow>
  );

  const rows = useMemo(
    () => visiblePrs(items, filters, viewer),
    [items, filters, viewer],
  );
  // The order applies **inside** each group — t3code's bargain, and the right one:
  // the groups answer "what wants me" first, and re-ordering across them would
  // mix a review request in with work that landed last week.
  const groups = useMemo(
    () => groupPrs(rows, viewer).map((group) => ({ ...group, items: sortPrs(group.items, filters.sort) })),
    [rows, viewer, filters.sort],
  );
  const authors = useMemo(() => authorFacets(items), [items]);
  const labels = useMemo(() => labelFacets(items), [items]);
  const multiRepo = useMemo(() => new Set(items.map((item) => item.repo)).size > 1, [items]);

  // Published rather than called: the reader's ⌘R reaches the page through this,
  // and so does a write made in the pane beside it.
  // ⌘R reaches whichever body is up: one chord, and the page is what knows
  // which of the two the reader is looking at.
  if (refreshRef) refreshRef.current = section === "actions" ? runs.refresh : invalidate;

  // **"No GitHub repository here" is a state, not a failure.** The red line is
  // for reads that went wrong; a project that is a scratch folder, or a
  // workspace holding repositories rather than being one, is the page simply
  // having nothing to list — and it says so in the same quiet words the
  // unattached case uses, with the path named so the reader knows which project
  // it means.
  if (!cwds.length || error?.kind === "no_remote") {
    // The source row is drawn even here: it is how the reader leaves, and a
    // state with nothing to press would be the one screen with no way off it.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-3">
          {tabs}
        </header>
        <Empty>
          {error?.kind === "no_remote"
            ? prUnavailableText(error, cwds[0])
            : "Attach a project with a GitHub remote to see its pull requests here."}
        </Empty>
      </div>
    );
  }

  // A read in flight with nothing to replace yet is the placeholders. Once rows
  // are up they stay up while the next read lands — a search retyping the list
  // under the reader costs more than the second it takes to answer.
  const firstRead = loading && !rows.length;

  const pullRequests = (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-3">
        {tabs}
        {subTabs}
        <div className="flex items-center gap-2">
          <h2 className="text-ui font-medium">Pull requests</h2>
          <span className="min-w-0 truncate text-ui text-muted-foreground">
            {/* One repository is named; several are counted, because naming one of
                them would be a lie about what is on screen. */}
            {cwds.length === 1
              ? (items[0]?.repo ?? cwds[0].split("/").filter(Boolean).at(-1))
              : `${cwds.length} repositories`}
          </span>
          {/* What is on screen, which the state below does not say: "Open" is
              what was asked for, and a repository can answer it with nothing. */}
          {!firstRead && rows.length > 0 && (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-ui text-muted-foreground tabular-nums">
              {rows.length}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="ml-auto cursor-pointer"
          >
            Close
          </Button>
        </div>

        {/* The controls, in the order they are reached for: type a search, order
            what came back, narrow it, ask again. **The two segment groups that
            used to sit here are gone** — six words of chrome spending the whole
            row on two choices, when the same two are a submenu each and the rest
            of the row is better spent on the search. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex h-7 min-w-40 flex-1 items-center gap-1.5 rounded-md border border-border px-2 text-ui focus-within:border-accent">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={filters.query}
              // Sent to GitHub rather than matched here: a repository has more
              // pull requests than `gh` will ever hand over in one listing, so a
              // local match would only ever search the fifty on screen.
              placeholder="Search GitHub"
              spellCheck={false}
              onChange={(e) => setFilters((prev) => ({ ...prev, query: e.currentTarget.value }))}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
          </label>

          <SortMenu
            sort={filters.sort}
            onChange={(sort) => setFilters((prev) => ({ ...prev, sort }))}
          />

          <FiltersMenu
            filters={filters}
            authors={authors}
            labels={labels}
            cwds={cwds}
            onChange={setFilters}
          />

          {/* The one control that is not a menu, and a glyph rather than a word:
              it says the same thing every time it is pressed, so the width a
              label would take is width the search is not getting. It spins
              instead of disabling itself, because a refresh that lands in under
              a frame otherwise looks like a press that missed. */}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Refresh pull requests"
            onClick={refresh}
            disabled={loading}
            className="cursor-pointer text-muted-foreground"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && (
          <div className="mx-1 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">{prUnavailableText(error, cwds[0])}</span>
          </div>
        )}

        {/* Some of the repositories could not be read. A sentence under the rows
            rather than over them: five of six is the ordinary case, and the page
            is not wrong for having read them. */}
        {failed && (
          <div className="mx-1 mb-2 flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-ui text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">
              {failed.count} of {cwds.length} repositories could not be read — {failed.detail}
            </span>
          </div>
        )}

        {firstRead && <PlaceholderRows />}

        {!error && !firstRead && !rows.length && (
          // `h-full` because the scroller is not a flex column: this is the one
          // child that has to fill the box it is centred in.
          <div className="flex h-full flex-col">
            <Empty>
              {loading ? "Reading this repository's pull requests…" : "Nothing matches that."}
            </Empty>
          </div>
        )}

        {!firstRead && rows.length > 0 && (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-0.5">
                {/* A heading only where the list is more than one run: over a single
                    group it answers a question nobody asked, and "Others" over every
                    row in a repository is the page saying its own default out loud. */}
                {groups.length > 1 && (
                  <h3 className="flex items-center gap-1.5 px-3 pt-1 pb-0.5 text-ui text-muted-foreground">
                    <span className="font-medium text-foreground">{group.label}</span>
                    <span className="tabular-nums">{group.items.length}</span>
                  </h3>
                )}
                {group.items.map((item) => (
                  <Row
                    // Keyed by repository as well as number: two checkouts can each
                    // have a #12, and one row would vanish behind the other.
                    key={prKey(item)}
                    item={item}
                    multiRepo={multiRepo}
                    // Lit where its detail is the one on screen — the tab the
                    // reader is looking at, not every tab they have open.
                    selected={!!picked && prKey(picked) === prKey(item)}
                    onSelect={() => onPick(item)}
                  />
                ))}
              </section>
            ))}
          </div>
        )}

      </div>

      {/* The count for a screen reader, since the rows say it visually and the
          page has no other place to say how many there are. */}
      <span className="sr-only" role="status">
        {items.length} pull requests
      </span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* **Hidden, not unmounted, both ways.** Switching sub-tabs costs neither
          body its scroll position or its filters, the bargain every hidden body
          in this app makes — and only the one on screen reads, so the other's
          hooks are paused rather than unmounted. */}
      <div className={cn("flex min-h-0 flex-1 flex-col", section === "actions" && "hidden")}>
        {pullRequests}
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col", section !== "actions" && "hidden")}>
        <RunsView
          tabs={
            <>
              {tabs}
              {subTabs}
            </>
          }
          cwds={cwds}
          runs={runs}
          branch={runBranch}
          onBranch={setRunBranch}
          picked={pickedRun}
          onPick={onPickRun}
        />
      </div>
    </div>
  );
}

/// A read with nothing behind it yet.
///
/// **Bars built from the real row's own boxes**, the bargain the providers list
/// makes: a title line where the title goes and a meta line under it, so the
/// rows land in the space the wait already took rather than pushing everything
/// down when they arrive. In `em` against `text-ui`, so a reader who raised the
/// interface size gets placeholders that grew with it.
function PlaceholderRows() {
  // Ragged, so the block reads as a list of things rather than as a table.
  const titles = ["w-72", "w-52", "w-64", "w-40", "w-56", "w-48"];

  return (
    <div aria-hidden className="flex flex-col gap-0.5">
      {titles.map((width) => (
        <div
          key={width}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg px-3 py-2 text-ui"
        >
          <span className="mt-0.5 size-4 shrink-0 animate-pulse rounded-full bg-muted-foreground/20" />
          <span className="flex flex-col gap-1">
            <span className={cn("h-[1.4em] animate-pulse rounded bg-muted-foreground/20", width)} />
            <span className="h-[1.3em] w-40 animate-pulse rounded bg-muted-foreground/10" />
          </span>
          <span className="mt-0.5 size-6 shrink-0 animate-pulse rounded-md bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  );
}

/// The picked row's own panel, drawn in the right pane — the same component the
/// session's tab draws, so a page and a tab cannot describe one pull request two
/// ways. `App` mounts it; it lives here because it is this page's detail and
/// nothing else's.
export function PrDetail({
  picked,
  active,
  onChanged,
}: {
  picked: PrRow | null;
  active: boolean;
  onChanged: () => void;
}) {
  // The repository comes off the row, not off the page: the list spans them, so
  // the pane follows whichever one was clicked rather than whichever the composer
  // happens to be pointed at.
  const data = usePullRequest(
    picked?.cwd ?? "",
    picked?.headRefName ?? null,
    active && !!picked,
    undefined,
    onChanged,
  );

  if (!picked) {
    return (
      <Empty>
        Choose a pull request to see its checks, its conversation and the buttons
        that act on it.
      </Empty>
    );
  }

  return (
    <PrPanel
      {...data}
      branch={picked.headRefName}
      cwd={picked.cwd}
      // The branch can carry more than one pull request — a stack, or the same
      // work retargeted — and this pane is about the row that was clicked.
      only={picked.number}
    />
  );
}

/// The pull requests the reader has open, as a strip of tabs.
///
/// **Several at once, and that is the whole of it.** Reading a second attempt
/// beside the first, or one pull request while its predecessor is still worth
/// looking at, is the ordinary reason to have two open — and the pane used to
/// hold exactly one, so opening the second threw the first away. Each keeps its
/// own read, its own scroll and its own expanded rows while the others sit
/// behind it, the bargain every hidden-not-unmounted body in this app makes.
///
/// Drawn into the frame's own strip rather than beside it: this is the same row
/// the session's tabs live in, wearing the reader's pull requests instead of
/// their views.
export function PrTabs({
  open,
  active,
  onActivate,
  onClose,
}: {
  open: readonly PrRow[];
  /// The key of the one on screen, or `null` while the pane is empty.
  active: string | null;
  onActivate: (pr: PrRow) => void;
  onClose: (pr: PrRow) => void;
}) {
  return (
    <>
      {open.map((pr) => (
        <Tab
          key={prKey(pr)}
          // The number rather than a mark: it is what a reader says out loud
          // about a pull request, and the state glyph would be a second copy of
          // what the row they opened it from already said.
          icon={<span className="shrink-0 tabular-nums text-muted-foreground">#{pr.number}</span>}
          label={pr.title}
          title={`#${pr.number} ${pr.title}`}
          active={prKey(pr) === active}
          onSelect={() => onActivate(pr)}
          onClose={() => onClose(pr)}
        />
      ))}
    </>
  );
}

/// One row: what it is, where it goes, and how it is doing.
///
/// **Two lines, and the split is what makes fifty of them scannable.** The title
/// and everything that is a *fact about the change* — the verdict on it, its
/// size, whether CI is still going — sit on the first line, because those are
/// what the reader is choosing between. Who wrote it, which branch it came from
/// and when it moved are context for one row already chosen, so they drop to the
/// second and stop competing with the titles.
///
/// A card rather than a bordered row: the list is the whole column here, so a
/// rule between every pair turns fifty rows into a table. `rounded-lg` is the
/// menu rung of the radius scale, and the hover and the pick are the one
/// `--surface-selected` token every other list in the app marks a row with.
function Row({
  item,
  multiRepo,
  selected,
  onSelect,
}: {
  item: PrRow;
  /// Whether the list spans repositories — the label is drawn only then, since
  /// one repository's own name on all fifty rows is a column of the same word.
  multiRepo: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const open = (e: SyntheticEvent) => {
    e.stopPropagation();
    void openUrl(item.url);
  };

  return (
    // A div behaving as a button, the shape `IssueRow` takes: it carries a
    // second focusable control, and two of those nested in a real `button` is
    // invalid markup whose keyboard behaviour assistive tech may collapse into
    // the row's own action.
    <div
      role="button"
      tabIndex={0}
      // ⌘-click leaves for GitHub, the same modifier the transcript's link
      // dialog and the issues list use to mean "out there, not here".
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          void openUrl(item.url);
          return;
        }
        onSelect();
      }}
      // A control inside the row answers its own keys, or Enter on it would
      // also pick the row underneath in one press.
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      className={cn(
        "group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg px-3 py-2 text-left text-ui transition-colors",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
        selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
      )}
    >
      <PrStateIcon pr={item} className="mt-0.5 size-4" strokeWidth={1.75} />

      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
        <span className="col-start-1 row-start-1 block truncate font-medium">{item.title}</span>

        <span className="col-start-2 row-start-1 flex shrink-0 items-center justify-self-end gap-2">
          <Verdict item={item} />
          {/* The sidebar marks a running check with this same dashed arc at the
              same 3s turn, so one fact wears one glyph across the app. A
              *verdict* is already carried by the glyph at the row's left edge —
              `PrStateIcon` recolours for a failure — so nothing is drawn here
              once checks have settled. */}
          {item.checksState === "RUNNING" && (
            <CircleDashed
              className="size-3.5 animate-spin text-accent-command [animation-duration:3s]"
              strokeWidth={1.5}
              aria-label="Checks running"
            />
          )}
          <Counts added={item.additions} removed={item.deletions} />
        </span>

        {/* Dot-separated, and each segment gives way at the end rather than
            pushing the ones after it off: a fifty-row list is read down one
            column, and a meta line that wraps would break that. `overflow-hidden`
            is the backstop for the segments that cannot give way — a row with
            three long labels would otherwise paint them over the timestamp. */}
        <MetaLine className="col-start-1 row-start-2 overflow-hidden text-muted-foreground">
          <span className="shrink-0 tabular-nums">#{item.number}</span>
          {multiRepo && <span className="min-w-0 truncate">{item.repo}</span>}
          <span className="min-w-0 max-w-40 truncate font-mono">{item.headRefName}</span>
          <span className="flex min-w-0 items-center gap-1">
            {/* The listing has no picture on it, so the face is asked for by
                login — see [loginAvatar] for why that is enough for a person
                and misses for an app. */}
            <Avatar
              src={item.avatar ?? loginAvatar(item.author)}
              name={item.author}
              className="size-3.5 text-[8px]"
            />
            <span className="truncate">{item.author}</span>
          </span>
          {item.labels.length > 0 && (
            <span className="flex min-w-0 shrink-0 items-center gap-1">
              {/* Three, then a count: a row carrying nine labels has pushed its
                  own title off the line, and "+6" says there are more without
                  spending the width of the words. */}
              {item.labels.slice(0, 3).map((label) => (
                <LabelChip key={label.name} name={label.name} color={label.color} />
              ))}
              {item.labels.length > 3 && (
                <span className="shrink-0">+{item.labels.length - 3}</span>
              )}
            </span>
          )}
          <Conflict item={item} />
        </MetaLine>

        <span className="col-start-2 row-start-2 shrink-0 justify-self-end text-muted-foreground/70 tabular-nums">
          {relativeTime(item.updatedAt)}
        </span>
      </span>

      {/* Revealed by the row's own hover, and its box is reserved either way —
          so the meta line never shifts under the cursor that revealed it.
          `pointer-events-none` until then, or a click aimed at the row would
          land on a control the reader had not been shown yet.

          A span carrying `buttonVariants` rather than a `Button`, for the
          nesting reason `IssueRow`'s "Work on it" gives. */}
      <span
        role="button"
        tabIndex={0}
        aria-label="Open on GitHub"
        onClick={open}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          open(e);
        }}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-xs" }),
          "mt-0.5 text-muted-foreground/60 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 hover:text-muted-foreground focus-visible:pointer-events-auto focus-visible:opacity-100",
          "pointer-events-none",
        )}
      >
        <ExternalLink className="size-3" />
      </span>
    </div>
  );
}

/// Whether anybody has said anything about this change yet.
///
/// **Only a verdict somebody actually gave.** "Review required" is the *absence*
/// of one, and a word saying so on every unreviewed row spends the scarce end of
/// the row saying nothing. Approval is a glyph: it is good news that needs no
/// action, and its own shape is as recognisable as the word. A change request
/// keeps the word, because that is the one the reader has to do something about.
function Verdict({ item }: { item: PrListItem }) {
  const decision = item.reviewDecision?.toUpperCase() ?? null;
  if (decision === "APPROVED") {
    return (
      <CircleCheck className="size-3.5 shrink-0 text-accent-add" aria-label="Approved" role="img" />
    );
  }
  if (decision === "CHANGES_REQUESTED") {
    return <span className="shrink-0 text-destructive">Changes requested</span>;
  }
  return null;
}

/// A conflict, said in words.
///
/// Colour alone would not carry it — red-green is the difference this palette
/// can least afford to make load-bearing — and the whole row already goes
/// nowhere until somebody resolves it. Kept to one word rather than naming the
/// base branch: the meta line is where it has to fit beside four other things,
/// and which branch is the question the detail pane answers.
function Conflict({ item }: { item: PrListItem }) {
  if (item.state !== "OPEN" || item.isDraft || item.mergeable !== "CONFLICTING") return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-destructive">
      <TriangleAlert className="size-3" />
      Conflicts
    </span>
  );
}

/// Added and removed lines, coloured the way every host colours them.
///
/// Nothing where the host reported no counts: `+0 −0` reads as an empty change
/// rather than as a missing one, which is exactly backwards for a row a reader
/// is judging by size.
function Counts({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="shrink-0 font-mono tabular-nums">
      {added > 0 && <span className="text-accent-add">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-destructive">−{removed}</span>}
    </span>
  );
}

/// One choice in a filter group: the value, the word for it, and the glyph that
/// makes the group scannable rather than read.
type FilterOption<Value extends string> = {
  value: Value;
  label: string;
  Icon: ComponentType<{ className?: string }>;
};

const STATE_OPTIONS = [
  { value: "open", label: "Open", Icon: GitPullRequest },
  { value: "merged", label: "Merged", Icon: GitMerge },
  { value: "closed", label: "Closed", Icon: GitPullRequestClosed },
  { value: "all", label: "All", Icon: Layers },
] as const satisfies readonly FilterOption<PrListState>[];

/// The words match the headings the list draws, not the words t3code uses for
/// the same three: a filter called "Reviewing" over a run called "Waiting on
/// you" is two names for one thing on a single screen.
const INVOLVEMENT_OPTIONS = [
  { value: "all", label: "Everyone", Icon: Layers },
  { value: "waiting", label: "Waiting on you", Icon: Eye },
  { value: "authored", label: "Yours", Icon: PenLine },
] as const satisfies readonly FilterOption<PrInvolvement>[];

const DRAFT_OPTIONS = [
  { value: ANY, label: "All", Icon: Layers },
  { value: "only", label: "Drafts only", Icon: GitPullRequestDraft },
  { value: "hide", label: "Hide drafts", Icon: EyeOff },
] as const satisfies readonly FilterOption<PrFilters["draft"]>[];

const REVIEW_OPTIONS = [
  { value: ANY, label: "All", Icon: Layers },
  { value: "approved", label: "Approved", Icon: CircleCheck },
  { value: "changes-requested", label: "Changes requested", Icon: CircleX },
  { value: "review-required", label: "Review required", Icon: CircleDashed },
  { value: "none", label: "No reviews", Icon: CircleSlash },
] as const satisfies readonly FilterOption<PrFilters["review"]>[];

const CHECKS_OPTIONS = [
  { value: ANY, label: "All", Icon: Layers },
  { value: "failing", label: "Failing", Icon: CircleX },
  { value: "clear", label: "Passing", Icon: CircleCheck },
] as const satisfies readonly FilterOption<PrFilters["checks"]>[];

/// The seven orders, each with the glyph that says which question it answers.
const SORT_OPTIONS = [
  { value: "ready", label: SORT_LABELS.ready, Icon: ListChecks },
  { value: "blocked", label: SORT_LABELS.blocked, Icon: UserLock },
  { value: "updated", label: SORT_LABELS.updated, Icon: Clock },
  { value: "newest", label: SORT_LABELS.newest, Icon: CalendarArrowDown },
  { value: "oldest", label: SORT_LABELS.oldest, Icon: CalendarArrowUp },
  { value: "largest", label: SORT_LABELS.largest, Icon: Maximize2 },
  { value: "smallest", label: SORT_LABELS.smallest, Icon: Minimize2 },
] as const satisfies readonly FilterOption<PrSort>[];

/// The order the rows inside each group are drawn in.
///
/// A menu rather than a row of buttons because there are seven and they are read
/// once each. The trigger says `Sort` and not the current order: the button sits
/// in a row of four, and the one thing the reader needs from it is what pressing
/// it does. Which order is on is one press away and drawn with a tick.
function SortMenu({ sort, onChange }: { sort: PrSort; onChange: (sort: PrSort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer gap-1.5 text-ui">
          <ArrowUpDown className="size-3.5 text-muted-foreground" />
          Sort
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup value={sort} onValueChange={(next) => onChange(next as PrSort)}>
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="cursor-pointer gap-2 text-ui"
            >
              <option.Icon className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// One narrowing, behind a submenu whose row names the value it is set to.
///
/// **The current value rides the trigger rather than the tick inside**, which is
/// the whole reason the menu is built from submenus: a reader who has narrowed
/// something can see what to without opening anything, and a list that is
/// short for a reason says the reason on the control that made it short.
function FilterSubmenu<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly FilterOption<Value>[];
  onChange: (value: Value) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-ui">
        <current.Icon className="size-3.5 text-muted-foreground" />
        <span className="flex-1 truncate">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-52">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== value) onChange(next as Value);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="cursor-pointer gap-2 text-ui"
            >
              <option.Icon className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/// Who wrote it, with a field to type a login into.
///
/// A search box rather than a plain radio list because a busy repository has
/// authors the reader has never heard of, and the one they want is the one they
/// can name. The picked login is kept at the top whatever the query: the value
/// the group is set to has to stay reachable, or the only way back to it is to
/// remember how it was spelled.
function AuthorFilter({
  value,
  authors,
  onChange,
}: {
  value: string;
  authors: AuthorFacet[];
  onChange: (author: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const selected = authors.find((author) => author.login.toLowerCase() === value.toLowerCase());
  const visible = [
    ...(selected ? [selected] : []),
    ...authors.filter(
      (author) =>
        author !== selected &&
        (needle.length === 0 || author.login.toLowerCase().includes(needle)),
    ),
  ].slice(0, 10);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-ui">
        <UserRound className="size-3.5 text-muted-foreground" />
        <span className="flex-1 truncate">Author</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {value === ANY ? "Anyone" : value}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <div className="p-1 pb-1.5">
          <label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-ui focus-within:border-accent">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              // Radix owns the keyboard while a menu is open, and its typeahead
              // reads every letter as "jump to the item starting with this" —
              // so the field keeps its own keys and hands Radix only the two it
              // needs to keep working: the arrows down into the list, and the
              // Escape that closes the menu.
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "Escape") e.stopPropagation();
              }}
              value={query}
              spellCheck={false}
              placeholder="Search authors"
              aria-label="Search authors"
              onChange={(e) => setQuery(e.currentTarget.value)}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
          </label>
        </div>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next || ANY)}
        >
          <DropdownMenuRadioItem value={ANY} className="cursor-pointer gap-2 text-ui">
            <Layers className="size-3.5 text-muted-foreground" />
            <span className="flex-1">Anyone</span>
          </DropdownMenuRadioItem>
          {visible.map((author) => (
            <DropdownMenuRadioItem
              key={author.login}
              value={author.login}
              className="cursor-pointer gap-2 text-ui"
            >
              <Avatar
                src={author.avatar ?? loginAvatar(author.login)}
                name={author.login}
                className="size-3.5 text-[8px]"
              />
              <span className="min-w-0 flex-1 truncate">{author.login}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {author.count}
              </span>
            </DropdownMenuRadioItem>
          ))}
          {visible.length === 0 && (
            <DropdownMenuItem disabled className="text-ui">
              No authors found
            </DropdownMenuItem>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/// The labels the listing carries, ticked one by one.
///
/// **Boxes rather than radios, and the menu stays open across a tick.** Two
/// labels are a narrowing and the reader is usually after a pair, so a menu that
/// shut on the first one would make the common case two trips.
function LabelFilter({
  value,
  labels,
  onChange,
}: {
  value: string[];
  labels: LabelFacet[];
  onChange: (labels: string[]) => void;
}) {
  const held = new Set(value.map((name) => name.toLowerCase()));
  // A label the last read dropped is still ticked and still nowhere to untick —
  // so anything selected that the listing no longer carries is drawn anyway.
  const options = [
    ...value
      .filter((name) => !labels.some((label) => label.name.toLowerCase() === name.toLowerCase()))
      .map((name) => ({ name, color: null, count: 0 })),
    ...labels,
  ];

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-ui">
        <Tag className="size-3.5 text-muted-foreground" />
        <span className="flex-1 truncate">Labels</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {value.length === 0 ? "Any" : `${value.length} selected`}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {options.map((label) => {
          const ticked = held.has(label.name.toLowerCase());
          return (
            <DropdownMenuCheckboxItem
              key={label.name.toLowerCase()}
              checked={ticked}
              // Otherwise Radix shuts the menu on every tick, and ticking three
              // labels is three openings of it.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() =>
                onChange(
                  ticked
                    ? value.filter((name) => name.toLowerCase() !== label.name.toLowerCase())
                    : [...value, label.name],
                )
              }
              className="cursor-pointer text-ui"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <LabelDot color={label.color} />
                <span className="min-w-0 flex-1 truncate">{label.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {label.count}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/// Everything that narrows the listing, in one menu.
///
/// **Submenus rather than a column of labelled radio sets.** Seven groups drawn
/// flat is a menu taller than the window, and every one of them is a question
/// asked on a different visit — so each keeps its own popup and the closed menu
/// is seven lines. The trigger counts what is off its default, because a short
/// list with no visible reason is the one thing this menu cannot be.
function FiltersMenu({
  filters,
  authors,
  labels,
  cwds,
  onChange,
}: {
  filters: PrFilters;
  authors: AuthorFacet[];
  labels: LabelFacet[];
  cwds: string[];
  onChange: (update: (prev: PrFilters) => PrFilters) => void;
}) {
  const set = <K extends keyof PrFilters>(key: K) =>
    (value: PrFilters[K]) =>
      onChange((prev) => ({ ...prev, [key]: value }));

  // Everything but the search, which has its own box, and the order, which is
  // not a narrowing — the count is a promise about why the list is short.
  const count = [
    filters.state !== DEFAULT_FILTERS.state,
    filters.involvement !== DEFAULT_FILTERS.involvement,
    filters.draft !== DEFAULT_FILTERS.draft,
    filters.review !== DEFAULT_FILTERS.review,
    filters.checks !== DEFAULT_FILTERS.checks,
    filters.author !== DEFAULT_FILTERS.author,
    filters.labels.length > 0,
    filters.repo !== DEFAULT_FILTERS.repo,
  ].filter(Boolean).length;

  const repos = cwds.map((cwd) => ({
    value: cwd,
    label: cwd.split("/").filter(Boolean).at(-1) ?? cwd,
  }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer gap-1.5 text-ui">
          <ListFilter className="size-3.5 text-muted-foreground" />
          Filters
          {count > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <FilterSubmenu
          label="State"
          value={filters.state}
          options={STATE_OPTIONS}
          onChange={set("state")}
        />
        <FilterSubmenu
          label="Involvement"
          value={filters.involvement}
          options={INVOLVEMENT_OPTIONS}
          onChange={set("involvement")}
        />

        <DropdownMenuSeparator />

        <AuthorFilter value={filters.author} authors={authors} onChange={set("author")} />
        {labels.length > 0 && (
          <LabelFilter value={filters.labels} labels={labels} onChange={set("labels")} />
        )}
        <FilterSubmenu
          label="Draft"
          value={filters.draft}
          options={DRAFT_OPTIONS}
          onChange={set("draft")}
        />
        <FilterSubmenu
          label="Review"
          value={filters.review}
          options={REVIEW_OPTIONS}
          onChange={set("review")}
        />
        <FilterSubmenu
          label="Checks"
          value={filters.checks}
          options={CHECKS_OPTIONS}
          onChange={set("checks")}
        />

        {/* Only where there is a second repository to tell it from. A group
            holding one option cannot narrow anything. */}
        {repos.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <FilterSubmenu
              label="Repository"
              value={filters.repo}
              options={[{ value: ANY, label: "All repositories", Icon: Layers }, ...repos.map((repo) => ({ ...repo, Icon: FolderGit2 }))]}
              onChange={set("repo")}
            />
          </>
        )}

        {/* The way out of a menu this long. It has to live here: the reader who
            has set four groups is not going to open all four to unset them, and
            the count on the trigger would otherwise be a number with no cure. */}
        {count > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-ui text-muted-foreground"
              onSelect={() =>
                onChange((prev) => ({ ...DEFAULT_FILTERS, sort: prev.sort }))
              }
            >
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-72 flex-col items-center gap-2.5 text-center">
        {/* The glyph says which list this is at a glance — the page's own empty
            state and the detail pane's both open on it — and takes the muted
            step below the sentence, so the words are still what is read. */}
        <GitPullRequest className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
        <p className="text-balance text-ui text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
