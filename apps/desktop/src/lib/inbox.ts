import { isAuthored, isWaiting } from "@/lib/prList";
import type { Issue, PrListItem } from "@/types/events";

/// The three runs the list is drawn in, in the order attention reaches them.
///
/// **The pull-requests page's own three, carried across both trackers.** A
/// reader who has used that page already knows what they mean, and inventing a
/// second vocabulary for the same question is how two lists that answer one
/// thing start disagreeing. What is added is that an *issue* can be waiting on
/// you too — the tracker's word for it is `urgent`, which is the only signal
/// Linear gives that outranks the queue.
export type InboxGroupKey = "waiting" | "yours" | "others";

export const GROUP_LABEL: Record<InboxGroupKey, string> = {
  waiting: "Waiting on you",
  yours: "Yours",
  others: "Others",
};

const GROUP_ORDER: readonly InboxGroupKey[] = ["waiting", "yours", "others"];

/// A read that could not be made, in the row both pages use for one.
///
/// **Tone varies on *what* failed**: a machine with no `gh`, or a tracker with no
/// key, is a state the reader can fix and the sentence names the cure, where a
/// refusal or a crash is something going wrong.
export type InboxNote = { tone: "bad" | "muted"; text: string };

/// What a row says at its right edge: why it is where it is.
///
/// **A word, always, and a tone beside it rather than instead of it.** Colour
/// alone is what this palette can least afford to make load-bearing — red is
/// also the app's destructive, and green is already the sidebar's unread mark —
/// so the sentence carries the meaning and the tone only agrees with it.
///
/// `null` is the ordinary answer and the one most rows give. The pull-requests
/// page's own rule, carried across: "Review required" is the *absence* of a
/// verdict, so a row saying it spends the scarce end of the line on nothing.
/// Here that covers every state the row already draws — a draft's own glyph, an
/// issue's state glyph, an open pull request nothing is wrong with — and what is
/// left is the short list of things that want the reader or will move on their
/// own.
export type InboxReason = { label: string; tone: "bad" | "good" };

const CONFLICT: InboxReason = { label: "Conflict", tone: "bad" };
const CHECKS_FAILING: InboxReason = { label: "Checks failing", tone: "bad" };
const CHANGES_REQUESTED: InboxReason = { label: "Changes requested", tone: "bad" };
const READY: InboxReason = { label: "Ready to merge", tone: "good" };
const URGENT: InboxReason = { label: "Urgent", tone: "bad" };

/// One row, from either tracker.
///
/// A tagged union rather than a row shape with both fields on it: what the click
/// does with the row is the whole of what the list is for, and a `pr` that is
/// null on half the rows is a `?` at every read.
export type InboxItem<P extends PrListItem = PrListItem> =
  | {
      kind: "pr";
      key: string;
      group: InboxGroupKey;
      reason: InboxReason | null;
      title: string;
      updatedAt: string;
      row: P;
    }
  | {
      kind: "issue";
      key: string;
      group: InboxGroupKey;
      reason: InboxReason | null;
      title: string;
      updatedAt: string;
      row: Issue;
    };

/// Why a pull request is where it is, or `null` where it is simply still open.
///
/// **The order is the logic**, and it is the same order `readyTier` reads: a
/// conflict outranks a failing check, because the reader can do nothing about
/// the checks until the branch merges cleanly; a review that asked for changes
/// outranks one that has not answered yet. Checks still running are absent
/// deliberately — the row draws the sidebar's own arc for those, one fact in one
/// shape across the app, where a word for it would be the same fact a second
/// time.
function prReason(item: PrListItem): InboxReason | null {
  if (item.mergeable === "CONFLICTING" || item.mergeStateStatus === "DIRTY") return CONFLICT;
  if (item.checksState === "FAILING") return CHECKS_FAILING;
  if (item.reviewDecision === "CHANGES_REQUESTED") return CHANGES_REQUESTED;
  if (item.reviewDecision === "APPROVED" && item.checksState === "CLEAR") return READY;
  return null;
}

/// Why an issue is where it is.
///
/// Priority and nothing else. Everything the issues page reads is already
/// assigned to the reader, so the state word would be the row's own glyph said
/// again in the scarcest strip on it — and `urgent` is the one signal Linear
/// gives that outranks the queue the reader is working down.
function issueReason(issue: Issue): InboxReason | null {
  return issue.priority === "urgent" ? URGENT : null;
}

/// Which run a row belongs to.
///
/// **A row in two groups goes to the first that claims it**, the rule the
/// pull-requests page already follows: a pull request you opened and were then
/// asked to review on is someone waiting on you, which is the thing to do. An
/// issue's only claim is the priority — everything here is already the reader's,
/// so "yours" is the resting state rather than news.
function groupOf(
  item: { kind: "pr"; row: PrListItem } | { kind: "issue"; row: Issue },
  viewer: string | null,
): InboxGroupKey {
  if (item.kind === "issue") return item.row.priority === "urgent" ? "waiting" : "yours";
  if (isWaiting(item.row, viewer)) return "waiting";
  return isAuthored(item.row, viewer) ? "yours" : "others";
}

/// Both trackers merged into one list, newest first inside each group.
///
/// Generic over the pull request's own row type so a caller's — the page's,
/// which carries the checkout it came from — survives the walk; widening to
/// `PrListItem` here would compile and then lose the field the click needs. The
/// `cwd` is required rather than optional because the key is built from it.
export function inboxItems<P extends PrListItem & { cwd: string }>(
  prs: P[],
  issues: Issue[],
  viewer: string | null,
): InboxItem<P>[] {
  const rows: InboxItem<P>[] = [];

  for (const row of prs) {
    rows.push({
      kind: "pr",
      // The checkout as well as the number: two clones of one repository are two
      // rows to the page that lists them, and the number alone would collide.
      key: `pr:${row.cwd}#${row.number}`,
      group: groupOf({ kind: "pr", row }, viewer),
      reason: prReason(row),
      title: row.title,
      updatedAt: row.updatedAt,
      row,
    });
  }

  for (const row of issues) {
    rows.push({
      kind: "issue",
      // The tracker as well as the identifier: a second tracker is a module
      // plus a variant on `IssueTracker`, and its identifiers will not be
      // Linear's.
      key: `issue:${row.tracker}:${row.identifier}`,
      group: groupOf({ kind: "issue", row }, viewer),
      reason: issueReason(row),
      title: row.title,
      updatedAt: row.updatedAt,
      row,
    });
  }

  return newestFirst(rows);
}

/// The rows split into the runs the page draws, empty ones dropped.
///
/// An empty group is not drawn, for the pull-requests page's reason: an empty
/// "Waiting on you" is the ordinary state, and a heading saying so is a heading
/// over nothing.
export function groupInbox<P extends PrListItem & { cwd: string }>(
  items: InboxItem<P>[],
): { key: InboxGroupKey; label: string; items: InboxItem<P>[] }[] {
  return GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_LABEL[key],
    items: items.filter((item) => item.group === key),
  })).filter((group) => group.items.length > 0);
}

/// Most recently touched first, which is the order both trackers' own listings
/// arrive in — and comparing their stamps is what makes one list out of two.
///
/// A stamp neither side can parse sorts last rather than throwing the order
/// away: the row is still worth drawing, and `NaN` reaching the comparator would
/// leave the whole list in whatever order the sort happened to leave it.
function newestFirst<P extends PrListItem & { cwd: string }>(
  rows: InboxItem<P>[],
): InboxItem<P>[] {
  const at = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  return rows.sort((a, b) => at(b.updatedAt) - at(a.updatedAt));
}
