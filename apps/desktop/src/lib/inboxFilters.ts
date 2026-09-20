import { basename } from "@/lib/format";
import type { InboxItem } from "@/lib/inbox";
import type { PrListItem } from "@/types/events";

/// How far back a row's own stamp has to be to stay on the list.
///
/// Three, and no picker: the question is "is this recent enough to still be
/// live", and a date range is a control for a question nobody asks of an inbox.
export type InboxTimeFilter = "all" | "today" | "week";

/// What the reader has narrowed the list by, beside the tab they are on.
///
/// **Local and not a second read.** Both halves arrive whole — the tracker's
/// assigned list, and one `gh` listing per repository — so narrowing them is a
/// filter and never a round trip, which is the opposite of the pull-requests
/// page, whose search has to be the host's because a repository holds more pull
/// requests than one listing will ever hand over.
export type InboxFilters = {
  /// Free text over everything a row says: its title, its number or key, the
  /// checkout or project it lives in, its branch, whoever wrote it.
  query: string;
  /// One checkout, or `all`. Applies to the pull request half alone — an issue
  /// does not live in a checkout — which is why the menu offers it only on a tab
  /// that can hold one.
  repo: string;
  /// One Linear project, or `all`, on the same terms and the other half.
  project: string;
  time: InboxTimeFilter;
  /// Only the run that is asking for the reader. The one filter here that is a
  /// question rather than a narrowing: it is what makes the list answer "what
  /// wants me" with nothing else on screen.
  waiting: boolean;
};

export const ANY = "all";

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  query: "",
  repo: ANY,
  project: ANY,
  time: "all",
  waiting: false,
};

export const TIME_LABEL: Record<InboxTimeFilter, string> = {
  all: "Any time",
  today: "Today",
  week: "Last 7 days",
};

export const TIME_OPTIONS: readonly InboxTimeFilter[] = ["all", "today", "week"];

/// The moment a row's stamp has to be at or after, or `null` for no bound.
///
/// `now` is a parameter rather than a read of the clock so the rule is testable
/// without one — the same bargain `calendarDay` and the palette's search make.
function timeStart(time: InboxTimeFilter, now: number): number | null {
  if (time === "all") return null;
  if (time === "today") return new Date(now).setHours(0, 0, 0, 0);
  return now - 7 * 24 * 60 * 60 * 1000;
}

/// Everything a row says, folded once — which is what a single box over two
/// trackers has to be. The number and the key are in it because they are what
/// the reader has in hand when they go looking: `#241` off a terminal, `DRA-53`
/// off a branch name.
function haystack<P extends PrListItem & { cwd: string }>(item: InboxItem<P>): string {
  const parts = [item.title];
  if (item.kind === "pr") {
    parts.push(`${basename(item.row.cwd)}#${item.row.number}`, item.row.headRefName, item.row.author);
  } else {
    parts.push(
      item.row.identifier,
      item.row.project ?? "",
      item.row.assignee?.name ?? "",
      item.row.labels.map((label) => label.name).join(" "),
    );
  }
  return parts.join(" ").toLowerCase();
}

/// The rows that survive every filter, in the order they arrived in.
///
/// **A row with a stamp nothing can parse is kept.** The filter is here to
/// narrow a list, not to lose a row nothing is known about — the other half of
/// `newestFirst`, which sorts one last rather than dropping it.
export function applyInboxFilters<P extends PrListItem & { cwd: string }>(
  items: InboxItem<P>[],
  filters: InboxFilters,
  now: number = Date.now(),
): InboxItem<P>[] {
  const needle = filters.query.trim().toLowerCase();
  const since = timeStart(filters.time, now);

  return items.filter((item) => {
    if (filters.waiting && item.group !== "waiting") return false;

    // Only the half that has the field answers the facet, and the other half
    // passes untouched: choosing a checkout is not a statement about issues.
    if (filters.repo !== ANY && item.kind === "pr" && item.row.cwd !== filters.repo) return false;
    if (filters.project !== ANY && item.kind === "issue" && item.row.project !== filters.project) {
      return false;
    }

    if (since !== null) {
      const at = Date.parse(item.updatedAt);
      if (!Number.isNaN(at) && at < since) return false;
    }

    return !needle || haystack(item).includes(needle);
  });
}

/// How many of the menu's own controls are off their default.
///
/// The search box is not counted: it is drawn on the row rather than inside the
/// menu, so a badge for it would say "filters on" about something the reader can
/// already see the words of.
export function inboxFilterCount(filters: InboxFilters): number {
  return (
    (filters.repo === ANY ? 0 : 1) +
    (filters.project === ANY ? 0 : 1) +
    (filters.time === "all" ? 0 : 1) +
    (filters.waiting ? 1 : 0)
  );
}

/// The checkouts the list holds pull requests from, as `cwd` → the name drawn.
///
/// One entry per checkout rather than per repository name: two clones of one
/// repository are two places work can land, and a menu that listed them once
/// could not say which.
export function repoOptions<P extends PrListItem & { cwd: string }>(
  items: InboxItem<P>[],
): { value: string; label: string }[] {
  const found = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "pr") found.set(item.row.cwd, basename(item.row.cwd));
  }
  return [...found].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/// The Linear projects the list holds issues from, alphabetically. Issues
/// outside every project are not offered: "no project" is a fact about an issue
/// rather than a place to look at.
export function projectOptions<P extends PrListItem & { cwd: string }>(
  items: InboxItem<P>[],
): string[] {
  const found = new Set<string>();
  for (const item of items) {
    if (item.kind === "issue" && item.row.project) found.add(item.row.project);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}
