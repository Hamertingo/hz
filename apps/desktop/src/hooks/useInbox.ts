import { useMemo } from "react";

import type { InboxPage } from "@/components/InboxTabs";
import { prUnavailableText, unavailableText } from "@/lib/unavailable";
import { useIssues } from "@/hooks/useIssues";
import { usePrList, type PrRow } from "@/hooks/usePrList";
import { inboxItems, type InboxItem, type InboxNote } from "@/lib/inbox";
import type { IssueUnavailable } from "@/types/events";

/// Everything the merged list needs, read once for the whole shell.
///
/// **A hook rather than the page's own state**, for a reason that shows in the
/// numbers: the source row is drawn by three surfaces, so how much is behind
/// each tab has to be read in one place or the same row says two different
/// things on two screens. `App` calls this, and what it hands down is a view
/// model — the rows, the two sentences a failed half wears, and the counts.
///
/// **Both reads happen at launch, not on arrival**, which is the whole point of
/// living up here: a listing is a `gh` spawn and the tracker is a round trip, so
/// a reader who has the app open has already paid for them by the time they
/// press a tab. Nothing here polls — `usePrList` reads once per key, and the
/// Refresh button is what re-asks.
export function useInbox(cwds: string[]) {
  const prs = usePrList(cwds, true, "open", "");
  const issues = useIssues(true);

  const items = useMemo(
    () => inboxItems(prs.items, issues.issues, prs.viewer),
    [prs.items, prs.viewer, issues.issues],
  );

  // One line each, and only where there is one. The two trackers fail
  // independently — a key Linear stopped accepting says nothing about `gh` —
  // and a list that drew neither would leave the reader wondering why half of
  // it is missing.
  const notes = useMemo(() => {
    const out: InboxNote[] = [];
    if (issues.unavailable) {
      out.push({
        tone: noteTone(issues.unavailable.kind),
        // The issues page draws the key field under its own sentence and this
        // list does not, so the one kind that has nowhere to go points at the
        // tab that does.
        text:
          issues.unavailable.kind === "not_connected"
            ? "No issue tracker connected — add one on the Linear tab."
            : unavailableText(issues.unavailable),
      });
    }
    if (prs.error) {
      out.push({
        tone: noteTone(prs.error.kind),
        // The page's own sentence, from the page's own helper: a missing `gh` is
        // the same fact here, and two spellings of one cure is one too many. What
        // stays there is the setup pane an install wants — this list has nowhere
        // to put a copy button.
        text: prUnavailableText(prs.error, cwds[0] ?? ""),
      });
    }
    if (prs.failed) {
      out.push({
        tone: "muted",
        text: `${prs.failed.count} of ${cwds.length} repositories could not be read — ${prs.failed.detail}`,
      });
    }
    return out;
  }, [issues.unavailable, prs.error, prs.failed, cwds]);

  const counts = useMemo(() => {
    const mine = items.filter((item) => item.kind === "pr").length;
    return { inbox: items.length, prs: mine, issues: items.length - mine };
  }, [items]);

  // Whether the *rows* span repositories, which is the same question the
  // pull-requests page asks of its own list: one repository's name repeated down
  // fifty rows is a column of the same word.
  const multiRepo = useMemo(() => new Set(prs.items.map((row) => row.repo)).size > 1, [prs.items]);

  return {
    items,
    notes,
    counts,
    multiRepo,
    /// Whether there is still a read to wait on, which is **two questions and not
    /// one**: `loading` covers whichever of the two is in flight, and `loaded` the
    /// issues half that has never answered at all. The pull request half has no
    /// such flag, and does not need one — its first commit takes its rows from the
    /// cache or its effect sets `loading` in the same tick.
    reading: issues.loading || prs.loading || !issues.loaded,
    refreshing: issues.loading || prs.loading,
    /// Both, always: this is one screen holding two reads, and a Refresh that
    /// re-asked only the half the reader is not looking at would leave the other
    /// one stale under a button that says it asked.
    refresh: () => {
      issues.refresh();
      prs.refresh();
    },
  } satisfies {
    items: InboxItem<PrRow>[];
    notes: InboxNote[];
    counts: Record<InboxPage, number>;
    multiRepo: boolean;
    reading: boolean;
    refreshing: boolean;
    refresh: () => void;
  };
}

/// Whether a failure is something broken or something not set up.
///
/// The kinds either tracker produces where the cure is a one-line install or a
/// login, and where red would make an ordinary state read as a defect. Everything
/// else is a refusal or a crash, which is what the destructive tone is for.
const SETUP_KINDS = ["not_connected", "no_cli", "not_authenticated", "no_remote"];

function noteTone(kind: IssueUnavailable["kind"] | string): "bad" | "muted" {
  return SETUP_KINDS.includes(kind) ? "muted" : "bad";
}
