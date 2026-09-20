import { useMemo, useState, type ReactNode, type SyntheticEvent } from "react";

import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CircleDashed,
  ExternalLink,
  Inbox,
  ListFilter,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";

import Avatar from "@/components/Avatar";
import IssueStateIcon from "@/components/IssueStateIcon";
import PrStateIcon from "@/components/PrStateIcon";
import { MetaLine } from "@/components/PrsView";
import { Button, buttonVariants } from "@/components/ui/button";
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
import type { PrRow } from "@/hooks/usePrList";
import { loginAvatar } from "@/lib/avatar";
import { relativeTime } from "@/lib/format";
import { groupInbox, type InboxItem, type InboxNote, type InboxReason } from "@/lib/inbox";
import {
  ANY,
  applyInboxFilters,
  DEFAULT_INBOX_FILTERS,
  inboxFilterCount,
  projectOptions,
  repoOptions,
  TIME_LABEL,
  TIME_OPTIONS,
  type InboxFilters,
  type InboxTimeFilter,
} from "@/lib/inboxFilters";
import { cn } from "@/lib/utils";

/// What this list says when both halves answered and neither has anything.
const NOTHING = "Nothing is in flight.";

/// Both trackers in one list.
///
/// **A presenter: it is handed its rows.** The two reads, the sentences a failed
/// half wears and the counts the source row carries all belong to
/// [useInbox](../hooks/useInbox.ts) — because that row is drawn by three
/// surfaces, and a number read in three places is three answers. What is here is
/// the drawing: the filter row, the row, and the three states of an empty one.
export default function InboxView({
  tabs,
  items,
  notes,
  reading,
  multiRepo,
  refreshing,
  onOpen,
  onRefresh,
}: {
  /// The source row. Taken as a node rather than drawn here, because all three
  /// surfaces wear it and it is the *shell* that owns which page is on screen.
  tabs: ReactNode;
  items: InboxItem<PrRow>[];
  notes: InboxNote[];
  /// A read still in flight, which is what the placeholders are for — and only
  /// while there is nothing on screen to keep. A cached answer is what the
  /// reader was looking at, and blanking it to re-read the same rows is the
  /// flicker the caches exist to remove.
  reading: boolean;
  multiRepo: boolean;
  refreshing: boolean;
  onOpen: (item: InboxItem<PrRow>) => void;
  onRefresh: () => void;
}) {
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS);

  const shown = useMemo(() => applyInboxFilters(items, filters), [items, filters]);
  const groups = useMemo(() => groupInbox(shown), [shown]);

  // The facets are read off the rows rather than asked for: every one of them is
  // already on screen, and a filter menu that has to fetch before it can open is
  // a menu that opens empty.
  const repos = useMemo(() => repoOptions(items), [items]);
  const projects = useMemo(() => projectOptions(items), [items]);

  const firstRead = reading && shown.length === 0 && notes.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-1.5">
          {tabs}

          {/* Far right, away from the tabs, for the reason the issues page puts
              it there: it acts on the whole page rather than narrowing it, so
              sitting among the things that narrow reads as one more of them. And
              it is what the `no_cli` sentence's "then Refresh" is addressed to. */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh the inbox"
            onClick={onRefresh}
            disabled={refreshing}
            className="ml-auto cursor-pointer text-muted-foreground"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>

        {/* The second row, and what it narrows is *this list* — the merged one.
            The two pages have their own, fuller rows, which is where a reader who
            wants the host's search and a sort goes. */}
        <div className="flex items-center gap-1.5">
          <label className="flex h-7 min-w-40 flex-1 items-center gap-1.5 rounded-md border border-border px-2 text-ui focus-within:border-accent">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={filters.query}
              // Matched here rather than sent anywhere: this list is already read
              // whole — one assigned query and one `gh` listing per repository — so
              // narrowing it is a filter and never a round trip.
              placeholder="Filter both"
              spellCheck={false}
              aria-label="Filter the inbox"
              onChange={(e) => setFilters((prev) => ({ ...prev, query: e.currentTarget.value }))}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
          </label>

          <FiltersMenu filters={filters} repos={repos} projects={projects} onChange={setFilters} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {notes.map((note) => (
          <Note key={note.text} tone={note.tone}>
            {note.text}
          </Note>
        ))}

        {firstRead && <PlaceholderRows />}

        {!firstRead && shown.length === 0 && notes.length === 0 && (
          // `h-full` because the scroller is not a flex column: this is the one
          // child that has to fill the box it is centred in.
          <div className="flex h-full flex-col">
            <Empty>
              {/* A narrowing with nothing left in it is not the same sentence as a
                  workspace with nothing in it, and saying the second over the
                  first sends the reader looking for work that is there. */}
              {reading ? "Reading…" : hasFilters(filters) ? "Nothing matches that." : NOTHING}
            </Empty>
          </div>
        )}

        {!firstRead && shown.length > 0 && (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-0.5">
                {/* Drawn for every run, unlike the pull-requests page's own three.
                    There "Others" over the whole repository is the page saying its
                    default out loud; here the *absence* of a run is the answer —
                    "Yours" with nothing above it is how this list says nothing is
                    waiting on the reader. */}
                <h3 className="flex items-center gap-1.5 px-3 pt-1 pb-0.5 text-ui text-muted-foreground">
                  <span className="font-medium text-foreground">{group.label}</span>
                  <span className="tabular-nums">{group.items.length}</span>
                </h3>
                {group.items.map((item) => (
                  <Row key={item.key} item={item} multiRepo={multiRepo} onOpen={() => onOpen(item)} />
                ))}
              </section>
            ))}
          </div>
        )}

        {/* The count for a screen reader, since the rows say it visually and the
            list has no other place to say how many there are. */}
        <span className="sr-only" role="status">
          {shown.length} items
        </span>
      </div>
    </div>
  );
}

/// Whether the reader has narrowed anything at all, the search box included —
/// which is the one place the search counts, because it is the one place the
/// question is "is this list empty or is it narrowed".
function hasFilters(filters: InboxFilters): boolean {
  return inboxFilterCount(filters) > 0 || filters.query.trim().length > 0;
}

/// The facets, behind one control.
///
/// **Submenus rather than a column of labelled radio sets**, the shape the
/// pull-requests page's menu takes and for its reason: each is a question asked
/// on a different visit, so each keeps its own popup and the closed menu is
/// short. The trigger counts what is off its default, because a short list with
/// no visible reason is the one thing this menu cannot be.
function FiltersMenu({
  filters,
  repos,
  projects,
  onChange,
}: {
  filters: InboxFilters;
  repos: { value: string; label: string }[];
  projects: string[];
  onChange: (filters: InboxFilters) => void;
}) {
  const count = inboxFilterCount(filters);
  const set = (patch: Partial<InboxFilters>) => onChange({ ...filters, ...patch });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 cursor-pointer gap-1.5 text-ui">
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
        <FacetMenu
          label="Repository"
          value={filters.repo}
          options={[{ value: ANY, label: "Any repository" }, ...repos]}
          onChange={(repo) => set({ repo })}
        />
        <FacetMenu
          label="Project"
          value={filters.project}
          options={[
            { value: ANY, label: "Any project" },
            ...projects.map((project) => ({ value: project, label: project })),
          ]}
          onChange={(project) => set({ project })}
        />
        <FacetMenu
          label="Time"
          value={filters.time}
          options={TIME_OPTIONS.map((time) => ({ value: time, label: TIME_LABEL[time] }))}
          onChange={(time) => set({ time: time as InboxTimeFilter })}
        />

        <DropdownMenuSeparator />

        {/* A checkbox rather than a submenu: it is one question with two answers,
            and the two-run list already says which rows it would keep. */}
        <DropdownMenuCheckboxItem
          checked={filters.waiting}
          onCheckedChange={(checked) => set({ waiting: !!checked })}
          className="cursor-pointer text-ui"
        >
          Waiting on you only
        </DropdownMenuCheckboxItem>

        {count > 0 && (
          <>
            <DropdownMenuSeparator />
            {/* The search box is deliberately left as it is: it is on the row
                above with the reader's own words in it, and a menu entry that
                emptied a field it does not own would read as one that failed. */}
            <DropdownMenuItem
              onSelect={() => onChange({ ...DEFAULT_INBOX_FILTERS, query: filters.query })}
              className="cursor-pointer text-ui"
            >
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// One facet, with the value it is set to riding its own trigger.
///
/// That is the whole reason these are submenus rather than a flat column: a
/// reader who has narrowed something can see what to without opening anything,
/// and a list that is short for a reason says the reason on the control that
/// made it short.
function FacetMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-ui">
        <span className="flex-1 truncate">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-52">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== value) onChange(next);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="cursor-pointer text-ui"
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/// One row: what it is, why it wants the reader, and where it lives.
///
/// **The pull-requests page's own row, widened to two trackers.** Two lines, and
/// the split is the same one: the title and everything that is a *fact about the
/// change* — the verdict on it, checks still running, whether it is a draft —
/// stay on the first, because those are what the reader is choosing between.
/// Where it lives, who wrote it and when it moved drop to the second. A card
/// rather than a bordered row, `rounded-lg`, marked with the one
/// `--surface-selected` token every other list in the app uses.
///
/// Typed on the page's own row, not the listing's: `cwd` and `repo` are what the
/// meta line draws and what `onOpen` opens, and it is `usePrList` that puts them
/// there. `InboxItem`'s parameter is the whole of that — widening it back to
/// `PrListItem` compiles and then loses the fields.
function Row({
  item,
  multiRepo,
  onOpen,
}: {
  item: InboxItem<PrRow>;
  multiRepo: boolean;
  onOpen: () => void;
}) {
  const open = (e: SyntheticEvent) => {
    e.stopPropagation();
    void openUrl(item.row.url);
  };

  return (
    // A div behaving as a button, the shape both sibling lists take: it carries
    // a second focusable control, and two of those nested in a real `button` is
    // invalid markup whose keyboard behaviour assistive tech may collapse into
    // the row's own action.
    <div
      role="button"
      tabIndex={0}
      // ⌘-click leaves for the tracker, the same modifier the transcript's link
      // dialog and both sibling lists use to mean "out there, not here".
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          void openUrl(item.row.url);
          return;
        }
        onOpen();
      }}
      // A control inside the row answers its own keys, or Enter on it would also
      // open the row underneath in one press.
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen();
      }}
      className={cn(
        "group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg px-3 py-2 text-left text-ui transition-colors",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
        "hover:bg-sidebar-accent/50",
      )}
    >
      {item.kind === "pr" ? (
        // The state is the glyph and never a word in the meta line: it is what
        // the whole left edge is for, and a draft's own shape says it.
        <PrStateIcon pr={item.row} className="mt-0.5 size-4" strokeWidth={1.75} />
      ) : (
        <IssueStateIcon
          kind={item.row.state.kind}
          color={item.row.state.color}
          label={item.row.state.name}
          className="mt-0.5 size-4"
        />
      )}

      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
        <span className="col-start-1 row-start-1 block truncate font-medium">{item.title}</span>

        <span className="col-start-2 row-start-1 flex shrink-0 items-center justify-self-end gap-2">
          {/* The sidebar's own dashed arc at its own 3s turn, so one fact wears
              one glyph across the app — and it is drawn *instead of* a reason,
              because a word for it would be the same fact a second time. */}
          {item.kind === "pr" && item.row.checksState === "RUNNING" && (
            <CircleDashed
              className="size-3.5 animate-spin text-accent-command [animation-duration:3s]"
              strokeWidth={1.5}
              aria-label="Checks running"
            />
          )}
          {item.reason && <Chip reason={item.reason} />}
        </span>

        {/* Dot-separated, and each segment gives way at the end rather than
            pushing the ones after it off: this is read down one column, and a
            meta line that wraps would break that. */}
        <MetaLine className="col-start-1 row-start-2 overflow-hidden text-muted-foreground">
          <span className="shrink-0 tabular-nums">
            {item.kind === "pr" ? `#${item.row.number}` : item.row.identifier}
          </span>
          {item.kind === "pr" && multiRepo && (
            <span className="min-w-0 truncate">{item.row.repo}</span>
          )}
          {item.kind === "pr" && (
            <span className="min-w-0 max-w-40 truncate font-mono">{item.row.headRefName}</span>
          )}
          {/* The author is a pull request's fact alone. Every issue this page
              reads is already assigned to the reader, so a name on all of them
              would be a column of the same word — the trap `multiRepo` above
              exists for, one field over. */}
          {item.kind === "pr" && (
            <span className="flex min-w-0 items-center gap-1">
              <Avatar
                src={item.row.avatar ?? loginAvatar(item.row.author)}
                name={item.row.author}
                className="size-3.5 text-[8px]"
              />
              <span className="truncate">{item.row.author}</span>
            </span>
          )}
          {item.kind === "issue" && item.row.project && (
            <span className="min-w-0 truncate">{item.row.project}</span>
          )}
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
          nesting reason the siblings give. */}
      <span
        role="button"
        tabIndex={0}
        aria-label={item.kind === "pr" ? "Open on GitHub" : "Open in Linear"}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          open(e);
        }}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-xs" }),
          "pointer-events-none mt-0.5 text-muted-foreground/60 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 hover:text-muted-foreground focus-visible:pointer-events-auto focus-visible:opacity-100",
        )}
      >
        <ExternalLink className="size-3" />
      </span>
    </div>
  );
}

/// Why the row is where it is, in one or two words.
///
/// **A word first and a fill second**, the rule every mark in this app follows:
/// red is also the destructive colour and green the sidebar's own unread one, so
/// the sentence carries the meaning and the tone only agrees with it. The chip
/// is the only coloured thing on a row — it is what makes the list scannable for
/// which of these are asking for something — and most rows wear none at all.
function Chip({ reason }: { reason: InboxReason }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-px",
        reason.tone === "good"
          ? "border-accent-add/30 bg-accent-add/10 text-accent-add"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {reason.label}
    </span>
  );
}

/// A read that could not be made, in the row shape both pages use for one.
///
/// The tone is the only thing that varies, and it varies on *what* failed: a
/// machine with no `gh`, or no tracker connected, is a state the reader can fix
/// and the sentence names the cure, where a refusal or a crash is something
/// going wrong. Neither is ever drawn as a page with nothing on it — an empty
/// list under a banner is a claim the banner has just contradicted.
function Note({ tone, children }: { tone: "bad" | "muted"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mx-1 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-ui",
        tone === "bad"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-border text-muted-foreground",
      )}
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/// A read with nothing behind it yet.
///
/// **Bars built from the real row's own boxes**, the bargain both sibling lists
/// make: a title line where the title goes and a meta line under it, so the rows
/// land in the space the wait already took rather than pushing everything down
/// when they arrive. In `em` against `text-ui`, so a reader who raised the
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

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-72 flex-col items-center gap-2.5 text-center">
        {/* The glyph says which list this is at a glance, and takes the muted
            step below the sentence so the words are still what is read. */}
        <Inbox className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
        <p className="text-balance text-ui text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
