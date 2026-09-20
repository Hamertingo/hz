import type { PrLabel, PrListItem, PrListState } from "@/types/events";

/// A row as the page holds it: the listing's own fields plus the checkout it came
/// from. Declared here rather than imported from the hook so the filter rules stay
/// free of anything that touches the bridge — `usePrList` adds nothing to it.
type Located = PrListItem & { cwd: string };

/// How the rows inside a group are ordered.
///
/// t3code's seven, and the default is the one that answers the question a reader
/// opens this page with — *which of these can I land* — rather than the one the
/// host happened to send. `newest` and `oldest` are by **creation**, which is why
/// a row carries `createdAt` as well as `updatedAt`: a year-old pull request
/// touched this morning is the newest by one and the oldest by the other.
export type PrSort = "ready" | "blocked" | "updated" | "newest" | "oldest" | "largest" | "smallest";

export const SORT_LABELS: Record<PrSort, string> = {
  ready: "Ready first",
  blocked: "Blocked first",
  updated: "Recently updated",
  newest: "Newest",
  oldest: "Oldest",
  largest: "Largest",
  smallest: "Smallest",
};

/// Which rows the page is showing.
///
/// The state is the *server's* filter (`gh pr list --state`), and the search is
/// too: a repository has thousands of pull requests and the only thing that can
/// page through them is the host. Involvement is the one decided here, because
/// answering it server-side would be a second and third spawn per refresh.
export type PrFilters = {
  state: PrListState;
  involvement: PrInvolvement;
  query: string;
  sort: PrSort;
  /// Drafts among the rows: `all`, or only them, or none of them. A draft is not
  /// waiting on a reviewer, so a reader looking for work to review wants them
  /// gone and a reader checking their own wants only them.
  draft: "all" | "only" | "hide";
  /// The tip commit's checks, folded the way a row wears them.
  checks: "all" | "failing" | "clear";
  /// What review stands at.
  review: "all" | "approved" | "changes-requested" | "review-required" | "none";
  /// One login, or every author.
  author: string;
  /// Label names, matched case-insensitively. **Every one of them has to be on
  /// the row** — a second label is a narrowing, not a second chance at matching,
  /// which is what a set of checkboxes means everywhere else.
  labels: string[];
  /// The repository to narrow to — a `cwd`, or `all`. A path rather than the
  /// display name, since two checkouts of one project share the latter.
  repo: string;
};

/// What the reader is to these pull requests.
///
/// t3code's three, and the grouping that falls out of them is the whole shape of
/// its page: what is waiting on you, then your own work, then everything else.
/// `all` is the ungrouped list.
export type PrInvolvement = "all" | "waiting" | "authored";

/// The value of every narrowing group that is set to nothing. One constant for
/// the whole file, because a group that invents its own "unset" spelling is one
/// the next group gets wrong.
export const ANY = "all";

export const DEFAULT_FILTERS: PrFilters = {
  state: "open",
  involvement: "all",
  query: "",
  sort: "ready",
  draft: ANY,
  checks: ANY,
  review: ANY,
  author: ANY,
  labels: [],
  repo: ANY,
};

/// Logins compare case-insensitively: GitHub spells them the same way every
/// time, but a team slug and a login in one list do not have to agree on case
/// with the viewer's own name.
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/// Whether this pull request is waiting on the reader.
///
/// A team request counts — the page cannot know whether the reader is on the
/// team without another call, and "somebody asked for a review" is the fact the
/// group is about. `viewer` null means `gh` would not say who we are, and then
/// nothing is waiting on us by name: every row falls to Others rather than a
/// guess.
export function isWaiting(item: PrListItem, viewer: string | null): boolean {
  if (!viewer) return false;
  return item.reviewRequests.some((who) => same(who, viewer));
}

export function isAuthored(item: PrListItem, viewer: string | null): boolean {
  if (!viewer) return false;
  return same(item.author, viewer);
}

export function matchesInvolvement(
  item: PrListItem,
  involvement: PrInvolvement,
  viewer: string | null,
): boolean {
  if (involvement === "waiting") return isWaiting(item, viewer);
  if (involvement === "authored") return isAuthored(item, viewer);
  return true;
}

/// How close a row is to landing, low is readier.
///
/// **One fixed order, and the order is the logic.** A closed pull request's merge
/// state is stale, a conflict outranks failing checks, and a draft is not waiting
/// on a reviewer at all — so the tiers are read in this sequence and nothing is
/// derived from the numbers beside them.
export function readyTier(item: PrListItem): number {
  if (item.mergeable === "CONFLICTING") return 4;
  if (item.state !== "OPEN") return 3;
  if (item.isDraft) return 2;
  if (item.checksState === "CLEAR" && item.reviewDecision === "APPROVED") return 0;
  if (item.checksState === "CLEAR") return 1;
  return 2;
}

const seconds = (iso: string) => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

/// The size of the change, which is what `largest` means: both directions count.
const size = (item: PrListItem) => item.additions + item.deletions;

/// One group's rows in the order the reader asked for.
///
/// The seven are t3code's. Their `blocked` order is per role — what a *reviewer*
/// is blocked on is not what an *author* is — and this one is the subset that
/// holds for both: what cannot land yet, worst first. Anything the host already
/// ordered is left alone for `updated`, which is its own answer: newest change
/// first, across every repository this page is reading.
export function sortPrs<T extends PrListItem>(items: T[], sort: PrSort): T[] {
  const rows = [...items];

  switch (sort) {
    case "updated":
      return rows.sort((a, b) => seconds(b.updatedAt) - seconds(a.updatedAt));
    case "newest":
      return rows.sort((a, b) => seconds(b.createdAt) - seconds(a.createdAt));
    case "oldest":
      return rows.sort((a, b) => seconds(a.createdAt) - seconds(b.createdAt));
    case "largest":
      return rows.sort((a, b) => size(b) - size(a));
    case "smallest":
      return rows.sort((a, b) => size(a) - size(b));
    case "blocked":
      return rows.sort(
        (a, b) =>
          blockedRank(b) - blockedRank(a) || seconds(b.updatedAt) - seconds(a.updatedAt),
      );
    case "ready":
      return rows.sort(
        (a, b) => readyTier(a) - readyTier(b) || seconds(b.updatedAt) - seconds(a.updatedAt),
      );
  }
}

/// How stuck a row is: a conflict worst, then a failing check, then a merge the
/// host says is blocked, then everything else.
function blockedRank(item: PrListItem): number {
  if (item.state !== "OPEN") return -1;
  if (item.mergeable === "CONFLICTING" || item.mergeStateStatus === "DIRTY") return 3;
  if (item.checksState === "FAILING") return 2;
  if (item.mergeStateStatus === "BLOCKED") return 1;
  return 0;
}

// The facets a filter menu is built from: everything the listing holds, cut down
// to the values a reader can pick between. Read off the rows rather than asked of
// the host — `gh` would answer these with another spawn per repository, and what
// the menu should offer is the values the rows on screen actually carry, since a
// filter that narrows to nothing is a dead control.

/// One author the listing holds, with the picture the row draws.
export type AuthorFacet = { login: string; avatar: string | null; count: number };

/// Sorted by login, because a menu that reorders itself as the listing moves is
/// a menu nobody can aim at. The avatar is the first one seen for a login, which
/// is the same face on every row that login wrote.
export function authorFacets(items: readonly PrListItem[]): AuthorFacet[] {
  const seen = new Map<string, AuthorFacet>();

  for (const item of items) {
    if (!item.author) continue;
    const held = seen.get(item.author);
    if (held) held.count += 1;
    else seen.set(item.author, { login: item.author, avatar: item.avatar, count: 1 });
  }

  return [...seen.values()].sort((a, b) => a.login.localeCompare(b.login));
}

/// One label the listing holds. Most-used first: a repository's twenty labels are
/// never all interesting, and the count is the only thing that says which are.
export type LabelFacet = PrLabel & { count: number };

export function labelFacets(items: readonly PrListItem[]): LabelFacet[] {
  const seen = new Map<string, LabelFacet>();

  for (const item of items) {
    for (const label of item.labels) {
      const key = label.name.toLowerCase();
      const held = seen.get(key);
      if (held) held.count += 1;
      else seen.set(key, { name: label.name, color: label.color, count: 1 });
    }
  }

  return [...seen.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

/// Generic over the row so a caller's own row type — the page's, which carries
/// the repository it came from — survives the walk. Widening to `PrListItem`
/// here would compile and then lose the field the row's click needs.
export type PrGroup<T extends PrListItem = PrListItem> = {
  key: "waiting" | "authored" | "others";
  label: string;
  items: T[];
};

const GROUP_LABEL = {
  waiting: "Waiting on you",
  authored: "Yours",
  others: "Others",
} as const;

/// The rows, split into the three runs the page draws.
///
/// **A group with nothing in it is not drawn**, which is the difference from
/// t3code here: their page is a workspace-wide worklist where an empty group is
/// still the answer to "nobody asked", and this one is a repository where an
/// empty "Waiting on you" is the ordinary state and a heading saying so is a
/// heading over nothing.
///
/// A row in two groups goes to the first that claims it, so a pull request you
/// opened and were then asked to review on appears under Waiting — the thing
/// that wants doing.
export function groupPrs<T extends PrListItem>(items: T[], viewer: string | null): PrGroup<T>[] {
  const buckets: PrGroup<T>[] = [
    { key: "waiting", label: GROUP_LABEL.waiting, items: [] },
    { key: "authored", label: GROUP_LABEL.authored, items: [] },
    { key: "others", label: GROUP_LABEL.others, items: [] },
  ];

  for (const item of items) {
    const bucket = isWaiting(item, viewer)
      ? buckets[0]
      : isAuthored(item, viewer)
        ? buckets[1]
        : buckets[2];
    bucket.items.push(item);
  }

  return buckets.filter((group) => group.items.length > 0);
}

/// The rows a filter leaves, in the order they arrived.
///
/// The order is `gh`'s — newest updated first — and it is deliberately not
/// re-sorted: the page groups by who is being waited on, and inside a group the
/// reader wants what moved last.
export function visiblePrs<T extends Located>(
  items: T[],
  filters: PrFilters,
  viewer: string | null,
): T[] {
  return items.filter(
    (item) =>
      matchesInvolvement(item, filters.involvement, viewer) &&
      matchesDraft(item, filters.draft) &&
      matchesChecks(item, filters.checks) &&
      matchesReview(item, filters.review) &&
      matchesLabels(item, filters.labels) &&
      (filters.author === ANY || item.author === filters.author) &&
      (filters.repo === ANY || item.cwd === filters.repo),
  );
}

/// Every selected label has to be on the row, which is what a set of checkboxes
/// means; one match out of three would be "any of these", the other control.
function matchesLabels(item: PrListItem, labels: string[]): boolean {
  if (labels.length === 0) return true;
  const held = item.labels.map((label) => label.name.trim().toLowerCase());
  return labels.every((name) => held.includes(name.trim().toLowerCase()));
}

function matchesDraft(item: PrListItem, draft: PrFilters["draft"]): boolean {
  if (draft === "only") return item.isDraft;
  if (draft === "hide") return !item.isDraft;
  return true;
}

function matchesChecks(item: PrListItem, checks: PrFilters["checks"]): boolean {
  if (checks === "failing") return item.checksState === "FAILING";
  if (checks === "clear") return item.checksState === "CLEAR";
  return true;
}

/// A review decision this app cannot spell is neither: it is only claimed by
/// "any" rather than filed under the nearest word.
function matchesReview(item: PrListItem, review: PrFilters["review"]): boolean {
  if (review === "all") return true;
  if (review === "none") return !item.reviewDecision;
  return item.reviewDecision?.toLowerCase() === review;
}

/// Whether a filter would change what is on screen — what the "clear" control is
/// drawn from, and what stops it from being a button that does nothing.
export function isFiltered(filters: PrFilters): boolean {
  return (
    filters.involvement !== DEFAULT_FILTERS.involvement ||
    filters.state !== DEFAULT_FILTERS.state ||
    filters.query.trim().length > 0 ||
    filters.draft !== DEFAULT_FILTERS.draft ||
    filters.checks !== DEFAULT_FILTERS.checks ||
    filters.review !== DEFAULT_FILTERS.review ||
    filters.author !== DEFAULT_FILTERS.author ||
    filters.labels.length > 0 ||
    filters.repo !== DEFAULT_FILTERS.repo
  );
}

/// Whether the *order* has been touched, which the clear button asks separately:
/// clearing a sort back to `ready` is not what a reader wants from a control that
/// says "clear the filters".
export function isSorted(filters: PrFilters): boolean {
  return filters.sort !== DEFAULT_FILTERS.sort;
}
