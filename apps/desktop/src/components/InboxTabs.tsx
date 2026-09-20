import { Inbox } from "lucide-react";

import GitHubIcon from "@/components/GitHubIcon";
import LinearIcon from "@/components/LinearIcon";
import { TabButton, TabRow } from "@/components/TabRow";

/// The three ways into the work, as one row.
///
/// **Drawn by all three surfaces it switches between** — the inbox and the two
/// pages — so a reader can move between them without going back through the
/// sidebar. And each tab is not a copy of a page but *the page itself*: GitHub
/// is [PrsView](../components/PrsView.tsx) with its own search, sort, filters,
/// refresh and detail pane, Linear is [IssuesView](../components/IssuesView.tsx)
/// with its own scope, filters and key field, and All is the merged list across
/// both trackers that neither of them can answer alone.
///
/// The buttons are [TabRow](./TabRow.tsx)'s, which is the plugins page's own
/// row: one control, so the two pages cannot describe the same shape two ways.
/// What is added here is the mark — the one thing that says *which* half of a
/// two-tracker list you are in before the word is read.
export type InboxPage = "inbox" | "prs" | "issues";

const TABS: { page: InboxPage; label: string }[] = [
  { page: "inbox", label: "All" },
  { page: "prs", label: "GitHub" },
  { page: "issues", label: "Linear" },
];

export default function InboxTabs({
  current,
  counts,
  onSelect,
}: {
  current: InboxPage;
  /// How much is behind each tab, read once by the shell — the counts are what
  /// make this row worth having over a menu, and three surfaces reading them
  /// separately would be three answers to one question.
  counts: Record<InboxPage, number>;
  onSelect: (page: InboxPage) => void;
}) {
  return (
    <TabRow>
      {TABS.map(({ page, label }) => (
        <TabButton
          key={page}
          active={current === page}
          label={label}
          count={counts[page]}
          onClick={() => onSelect(page)}
          // `aria-hidden` on both, since the word beside them is the name — read
          // out, the pair would say "GitHub GitHub".
          icon={
            page === "prs" ? (
              <GitHubIcon className="size-3.5" />
            ) : page === "issues" ? (
              <LinearIcon className="size-3.5" />
            ) : (
              <Inbox className="size-3.5" strokeWidth={1.75} />
            )
          }
        />
      ))}
    </TabRow>
  );
}
