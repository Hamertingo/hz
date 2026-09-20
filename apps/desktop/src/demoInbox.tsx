import React from "react";
import ReactDOM from "react-dom/client";

import InboxView from "@/components/InboxView";
import RunDetail from "@/components/RunDetail";
import InboxTabs from "@/components/InboxTabs";
import { TabButton, TabRow } from "@/components/TabRow";
import PrsView from "@/components/PrsView";
import { inboxItems } from "@/lib/inbox";
import type { PrRow } from "@/hooks/usePrList";
import type { Issue, IssueStateKind, PrListItem } from "@/types/events";
import { setTheme } from "@/hooks/useTheme";
import type { ThemeName } from "@/lib/theme";
import "./App.css";

/// Runs written down, one of every state a row can wear — including the two a
/// real capture would not hold: something still going, and something queued.
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const RUNS = [
  { id: 9, number: 12, attempt: 1, workflow: "CI", title: "Fold the turn's file list into one row",
    branch: "worktree-calm-navy-beacon", sha: "1a2b3c4d5e6f", event: "push",
    status: "in_progress", conclusion: null, createdAt: iso(1.5), startedAt: iso(1.3),
    updatedAt: iso(0.1), url: "https://github.com/example/hz/actions/runs/9" },
  { id: 8, number: 13, attempt: 1, workflow: "Release", title: "chore(release): 0.22.2",
    branch: "v0.22.2", sha: "7776f79f15f7", event: "push",
    status: "queued", conclusion: null, createdAt: iso(0.3), startedAt: null,
    updatedAt: iso(0.3), url: "https://github.com/example/hz/actions/runs/8" },
  { id: 7, number: 241, attempt: 2, workflow: "CI", title: "Keep the PR tab when gh is missing",
    branch: "keep-gh-tab", sha: "97c0b0aa87c2", event: "pull_request",
    status: "completed", conclusion: "failure", createdAt: iso(40), startedAt: iso(40),
    updatedAt: iso(33), url: "https://github.com/example/hz/actions/runs/7" },
  { id: 6, number: 197, attempt: 1, workflow: "Warm cache", title: "chore(release): 0.22.2",
    branch: "main", sha: "7776f79f15f7", event: "push",
    status: "completed", conclusion: "success", createdAt: iso(180), startedAt: iso(180),
    updatedAt: iso(170), url: "https://github.com/example/hz/actions/runs/6" },
  { id: 5, number: 70, attempt: 1, workflow: "pages build and deployment",
    title: "pages build and deployment", branch: "updates", sha: "3e27bcf28f2b", event: "dynamic",
    status: "completed", conclusion: "success", createdAt: iso(300), startedAt: iso(300),
    updatedAt: iso(299.6), url: "https://github.com/example/hz/actions/runs/5" },
  { id: 4, number: 43, attempt: 1, workflow: "Release", title: "chore(release): 0.14.0-beta.1",
    branch: "v0.14.0-beta.1", sha: "c9bfb97567ba", event: "push",
    status: "completed", conclusion: "cancelled", createdAt: iso(1560), startedAt: iso(1560),
    updatedAt: iso(1500), url: "https://github.com/example/hz/actions/runs/4" },
  { id: 3, number: 38, attempt: 1, workflow: "CI", title: "Move the provider form into the row",
    branch: "provider-inline-form", sha: "abcdef123456", event: "pull_request",
    status: "completed", conclusion: "skipped", createdAt: iso(4320), startedAt: iso(4320),
    updatedAt: iso(4319), url: "https://github.com/example/hz/actions/runs/3" },
];

/// A pull-request listing, stubbed outside the components.
///
/// The PRs page reads through `usePrList`, so the only way to look at it on a
/// page — its own controls, its rows, and the tab row above both — is to answer
/// that call. Done here rather than behind a flag in `src/`, so nothing in the
/// app carries a seam a demo needs.
const PRS: PrListItem[] = [
  {
    number: 241,
    title: "Keep the PR tab when gh is missing, and say how to install it",
    url: "https://github.com/example/hz/pull/241",
    state: "OPEN",
    isDraft: false,
    author: "hamerti",
    avatar: null,
    headRefName: "keep-gh-tab",
    baseRefName: "main",
    updatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    createdAt: "2026-09-01T00:00:00Z",
    additions: 42,
    deletions: 7,
    changedFiles: 3,
    reviewDecision: "CHANGES_REQUESTED",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checksState: "FAILING",
    reviewRequests: ["hamerti"],
    labels: [{ name: "app", color: "6f42c1" }],
  },
  {
    number: 238,
    title: "Virtualise the files viewer",
    url: "https://github.com/example/hz/pull/238",
    state: "OPEN",
    isDraft: false,
    author: "them",
    avatar: null,
    headRefName: "diffs-virtualizer",
    baseRefName: "main",
    updatedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    createdAt: "2026-09-01T00:00:00Z",
    additions: 310,
    deletions: 44,
    changedFiles: 9,
    reviewDecision: "APPROVED",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checksState: "RUNNING",
    reviewRequests: [],
    labels: [],
  },
  {
    number: 219,
    title: "Say which half of the protocol is behind",
    url: "https://github.com/example/hz/pull/219",
    state: "OPEN",
    isDraft: true,
    author: "hamerti",
    avatar: null,
    headRefName: "protocol-version-refusal",
    baseRefName: "main",
    updatedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    createdAt: "2026-08-30T00:00:00Z",
    additions: 12,
    deletions: 1,
    changedFiles: 1,
    reviewDecision: null,
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    checksState: "CLEAR",
    reviewRequests: [],
    labels: [],
  },
];

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => {
    if (cmd === "list_pull_requests") return { items: PRS, viewer: "hamerti" };
    if (cmd === "list_workflow_runs") return RUNS;
    if (cmd === "get_workflow_run") return RUN_DETAIL;
    if (cmd === "get_run_log") return RUN_LOG;
    if (cmd === "rerun_workflow") return null;
    if (cmd === "list_issues") return [];
    if (cmd === "list_issue_filters") return { teams: [], projects: [], teamStates: {} };
    if (cmd === "viewer_login") return "hamerti";
    throw new Error(`demo: nothing stubbed for ${cmd}`);
  },
};

/// Rows written down rather than fetched.
///
/// The inbox reads two trackers, so neither half can be seen without the other
/// end of both of them being connected — which is one machine and a bad way to
/// look at a list. `InboxView` takes the rows it draws, so this page hands it a
/// fixed set and **the rules that produced them are the real ones**: the reason,
/// the group and the order all come out of `inboxItems`.
const prRow = (over: Partial<PrListItem> & { cwd?: string; repo?: string } = {}) =>
  ({
    number: 1,
    title: "a pull request",
    url: "https://github.com/example/repo/pull/1",
    state: "OPEN",
    isDraft: false,
    author: "hamerti",
    avatar: null,
    headRefName: "worktree-calm-navy-beacon",
    baseRefName: "main",
    updatedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    createdAt: "2026-08-01T00:00:00Z",
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    reviewDecision: null,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checksState: "CLEAR",
    reviewRequests: [],
    labels: [],
    cwd: "/Users/you/code/hz",
    repo: "hz",
    ...over,
  }) as PrRow;

const issueRow = (over: Partial<Issue> = {}) =>
  ({
    tracker: "linear",
    id: "uuid",
    identifier: "DRA-53",
    title: "an issue",
    url: "https://linear.app/example/issue/DRA-53",
    state: { id: "s", name: "Todo", kind: "unstarted" as IssueStateKind, color: "#e2e2e2" },
    priority: "medium",
    assignee: { name: "Hamerti", avatar: null },
    labels: [],
    team: "DRA",
    project: null,
    updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    ...over,
  }) as Issue;

const VIEWER = "hamerti";

const MIXED = inboxItems(
  [
    prRow({
      number: 241,
      title: "Keep the PR tab when gh is missing, and say how to install it",
      reviewRequests: [VIEWER],
      reviewDecision: "CHANGES_REQUESTED",
      checksState: "FAILING",
      headRefName: "keep-gh-tab",
      updatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    }),
    prRow({
      number: 238,
      title: "Virtualise the files viewer",
      reviewRequests: [VIEWER],
      checksState: "RUNNING",
      headRefName: "diffs-virtualizer",
      repo: "hz-web",
      cwd: "/Users/you/code/hz-web",
      updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    }),
    prRow({
      number: 231,
      title: "Fold the turn's file list into one row",
      author: "them",
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
      repo: "hz-web",
      cwd: "/Users/you/code/hz-web",
      updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    }),
    prRow({
      number: 219,
      title: "Say which half of the protocol is behind",
      reviewDecision: "APPROVED",
      checksState: "CLEAR",
      headRefName: "protocol-version-refusal",
      updatedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    }),
    prRow({
      number: 214,
      title: "Draft: move the browser onto its own process",
      isDraft: true,
      headRefName: "cef-out-of-process",
      updatedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    }),
    prRow({
      number: 207,
      title: "Give the composer a size the reader picked",
      headRefName: "font-sizes",
      updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    }),
  ],
  [
    issueRow({
      identifier: "DRA-53",
      title: "Dictation loses the sentence when the model fails to load",
      priority: "urgent",
      project: "Composer",
      state: { id: "s", name: "In Progress", kind: "started", color: "#f2c94c" },
      updatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    }),
    issueRow({
      identifier: "DRA-61",
      title: "A search hit should open the sentence, not the session",
      project: "Command palette",
      updatedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    }),
    issueRow({
      identifier: "DRA-58",
      title: "An automation cannot be edited, only remade",
      project: "Automations",
      state: { id: "s", name: "Backlog", kind: "backlog", color: "#6b6f76" },
      updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    }),
  ],
  VIEWER,
);

const ALONE = inboxItems(
  Array.from({ length: 6 }, (_, index) =>
    prRow({
      number: 190 - index * 3,
      title:
        [
          "Take the menu off the title attribute",
          "Hold the panel's width while it is wide",
          "Read the worktree base off the reflog",
          "Key a snapshot's cache by its tree id",
          "Stop the coalescer pushing its own deadline",
          "Print the three phases of a session start",
        ][index] ?? "row",
      headRefName: `worktree-${["calm-navy-beacon", "warm-steel-otter", "quiet-amber-heron"][index % 3]}`,
      updatedAt: new Date(Date.now() - (index + 1) * 5 * 3_600_000).toISOString(),
    }),
  ),
  [],
  VIEWER,
);

/// A run opened: one job that failed at a step, one that was skipped whole.
const RUN_DETAIL = {
  run: { ...RUNS[2], cwd: "/Users/you/code/hz", repo: "hz" },
  jobs: [
    {
      id: 1, name: "build", status: "completed", conclusion: "failure",
      startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      completedAt: new Date(Date.now() - 33 * 60_000).toISOString(),
      steps: [
        { number: 1, name: "Set up job", status: "completed", conclusion: "success",
          startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
          completedAt: new Date(Date.now() - 39.9 * 60_000).toISOString() },
        { number: 2, name: "Run actions/checkout@v4", status: "completed", conclusion: "success",
          startedAt: new Date(Date.now() - 39.9 * 60_000).toISOString(),
          completedAt: new Date(Date.now() - 39.8 * 60_000).toISOString() },
        { number: 3, name: "Run pnpm install --frozen-lockfile", status: "completed", conclusion: "success",
          startedAt: new Date(Date.now() - 39.8 * 60_000).toISOString(),
          completedAt: new Date(Date.now() - 37 * 60_000).toISOString() },
        { number: 4, name: "Run pnpm lint", status: "completed", conclusion: "failure",
          startedAt: new Date(Date.now() - 37 * 60_000).toISOString(),
          completedAt: new Date(Date.now() - 33.4 * 60_000).toISOString() },
        { number: 5, name: "Post Run actions/checkout@v4", status: "completed", conclusion: "success",
          startedAt: new Date(Date.now() - 33.2 * 60_000).toISOString(),
          completedAt: new Date(Date.now() - 33 * 60_000).toISOString() },
      ],
    },
    {
      id: 2, name: "manifest", status: "completed", conclusion: "skipped",
      startedAt: new Date(Date.now() - 33 * 60_000).toISOString(),
      completedAt: new Date(Date.now() - 33 * 60_000).toISOString(),
      steps: [],
    },
  ],
};

/// A run's log, in `gh`'s own three-column shape, with the runner's markers in
/// the messages — one step that passed, one that failed with an error among its
/// output, and a nested group inside the one that passed.
const logLine = (message: string) =>
  `build\tUNKNOWN STEP\t2026-09-20T14:46:38.0000000Z ${message}\n`;

const RUN_LOG = [
  logLine("Current runner version: '2.337.0'"),
  logLine("##[group]Runner Image Provisioner"),
  logLine("Hosted Compute Agent"),
  logLine("##[endgroup]"),
  logLine("##[group]Run actions/checkout@v4"),
  logLine("Syncing repository: example/hz"),
  logLine("##[group]Getting Git version info"),
  logLine("git version 2.51.0"),
  logLine("##[endgroup]"),
  logLine("##[command]git config --local --name-only --get-regexp core\\.\\*"),
  logLine("##[endgroup]"),
  logLine("##[group]Run pnpm install --frozen-lockfile"),
  logLine("##[command]pnpm install --frozen-lockfile"),
  logLine("Lockfile is up to date, resolution step is skipped"),
  logLine("Progress: resolved 812, reused 776, downloaded 0, added 0, done"),
  logLine("##[endgroup]"),
  logLine("##[group]Run pnpm lint"),
  logLine("##[command]pnpm lint"),
  logLine("> hz@0.22.2 lint /Users/you/code/hz/apps/desktop"),
  logLine("> biome lint src"),
  logLine(""),
  logLine("src/harness/mcode.rs:214:9 lint/style/noNonNullAssertion  FIXABLE"),
  logLine(""),
  logLine("  × Forbidden non-null assertion."),
  logLine(""),
  logLine("Checked 352 files in 84ms. No fixes applied."),
  logLine("##[error]Process completed with exit code 1."),
  logLine("##[endgroup]"),
  logLine("##[group]Post Run actions/checkout@v4"),
  logLine("##[command]git config --local --unset-all extensions.worktreeConfig"),
  logLine("##[endgroup]"),
].join("");

function Case({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-ui font-medium">{title}</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">{note}</p>
      </div>
      {/* The main column, roughly: the inbox is a page, not a pane, so it is
          read at the window's own width rather than at 512px. */}
      <div className="flex h-[600px] w-[760px] flex-col overflow-hidden rounded-xl border border-border bg-background">
        {children}
      </div>
    </section>
  );
}

/// One case at a time under `?case=N`, all of them otherwise, and the source
/// tab under `?tab=github`.
///
/// A demo affordance and nothing else: a page of six stacked cases is a
/// screenshot nothing can be read in, and a case looked at one at a time is the
/// only way a 13px row can be judged. The tab is pressed by asking the live DOM
/// for the button whose label matches, so the demo does not carry a second copy
/// of the state the shell owns.
const params = new URLSearchParams(location.search);
const only = params.get("case");

/// Presses a control by the words on it, once the page has painted.
///
/// `pointerdown` for the menus: Radix opens on that rather than on a click, and
/// a demo that cannot open a menu cannot be looked at.
function press(match: (text: string) => boolean, event = "click") {
  setTimeout(() => {
    const control = [...document.querySelectorAll("button")].find((button) =>
      match((button.textContent ?? "").toLowerCase()),
    );
    control?.dispatchEvent(new MouseEvent(event, { bubbles: true, button: 0, cancelable: true }));
  }, 400);
}

if (params.get("tab")) {
  const wanted = params.get("tab") ?? "";
  press((text) => text.startsWith(wanted));
}

if (params.get("menu")) {
  press((text) => text.startsWith("filters"), "pointerdown");
}

// **The palette is asked for by name, and applied before the first paint.** A
// demo draws the real components, so the app's own store would otherwise put the
// default palette back on mount — and the whole point of asking is to see a
// *ported* theme's own surfaces, where a token that is nearly invisible in the
// default ramp can be a slab.
const asked = new URLSearchParams(location.search).get("theme");
if (asked) setTheme(asked as ThemeName);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div className="flex flex-col gap-10 p-10">
      <h1 className="text-lg font-medium">Inbox</h1>

      {(!only || only === "mixed") && (
        <Case
          title="Both trackers, all three runs"
          note="Every reason the rules can produce, plus the two rows that wear nothing: a draft, and an open pull request nobody has to act on."
        >
          <InboxView tabs={<InboxTabs current="inbox" counts={{ inbox: 9, prs: 6, issues: 3 }} onSelect={() => {}} />} items={MIXED} notes={[]} reading={false} refreshing={false} onRefresh={() => {}} multiRepo onOpen={() => {}} />
        </Case>
      )}

      {(!only || only === "alone") && (
        <Case
          title="One run only"
          note="The ordinary state of a personal inbox: everything is the reader's, so the heading is the page saying nothing is waiting on them."
        >
          <InboxView tabs={<InboxTabs current="inbox" counts={{ inbox: 9, prs: 6, issues: 3 }} onSelect={() => {}} />} items={ALONE} notes={[]} reading={false} refreshing={false} onRefresh={() => {}} multiRepo={false} onOpen={() => {}} />
        </Case>
      )}

      {(!only || only === "reading") && (
        <Case
          title="Reading, with nothing behind it"
          note="Bars built from the real row's own boxes, so the list does not move when the answer lands."
        >
          <InboxView tabs={<InboxTabs current="inbox" counts={{ inbox: 9, prs: 6, issues: 3 }} onSelect={() => {}} />} items={[]} notes={[]} reading refreshing={false} onRefresh={() => {}} multiRepo onOpen={() => {}} />
        </Case>
      )}

      {(!only || only === "empty") && (
        <Case title="Nothing in flight" note="Neither tracker has anything for the reader.">
          <InboxView tabs={<InboxTabs current="inbox" counts={{ inbox: 9, prs: 6, issues: 3 }} onSelect={() => {}} />} items={[]} notes={[]} reading={false} refreshing={false} onRefresh={() => {}} multiRepo onOpen={() => {}} />
        </Case>
      )}

      {(!only || only === "notes") && (
        <Case
          title="A tracker that could not be read"
          note="A setup state in the muted tone, a partial failure under it, and rows that did arrive — the note replaces the empty sentence rather than sitting over one."
        >
          <InboxView
            tabs={<InboxTabs current="inbox" counts={{ inbox: 9, prs: 6, issues: 3 }} onSelect={() => {}} />}
            items={inboxItems(
              [prRow({ number: 241, title: "Keep the PR tab when gh is missing" })],
              [],
              VIEWER,
            )}
            notes={[
              {
                tone: "muted",
                text: "No issue tracker connected — add one on the Linear tab.",
              },
              {
                tone: "muted",
                text: "1 of 2 repositories could not be read — no such file or directory",
              },
            ]}
            reading={false}
            refreshing={false}
            onRefresh={() => {}}
            multiRepo
            onOpen={() => {}}
          />
        </Case>
      )}

      {(!only || only === "prs") && (
        <Case
          title="The GitHub tab is the pull-requests page"
          note="Not a copy of it: the same search, the same Sort, the same Filters, the same refresh and the same detail pane. The tab row above them is the only thing this shell adds."
        >
          <PrsView
            tabs={<InboxTabs current="prs" counts={{ inbox: 9, prs: 6, issues: 3 }} onSelect={() => {}} />}
            cwds={["/Users/you/code/hz"]}
            active
            picked={null}
            onPick={() => {}}
            onClose={() => {}}
            pickedRun={null}
            onPickRun={() => {}}
          />
        </Case>
      )}

      {(!only || only === "tabs") && (
        <Case
          title="One control, two pages"
          note="The row above is the plugins page's own, rendered from the same component with the same counts. The inbox's is under it. They cannot differ: there is one TabRow."
        >
          <div className="flex flex-col gap-3 p-4">
            <TabRow>
              <TabButton active label="Skills" count={12} onClick={() => {}} />
              <TabButton active={false} label="MCP servers" count={2} onClick={() => {}} />
              <TabButton active={false} label="Agents" count={3} onClick={() => {}} />
            </TabRow>
            <InboxTabs current="inbox" counts={{ inbox: 9, prs: 6, issues: 3 }} onSelect={() => {}} />
          </div>
        </Case>
      )}

      {(!only || only === "rundetail") && (
        <Case
          title="A run, opened"
          note="The row says a run failed; this says where. Every step is drawn, not only the red one — the steps around a failure are what tell a change from a runner. The button's verb is what it will do: failed jobs, or the whole workflow."
        >
          <div className="flex h-full min-h-0 w-96 flex-col border-r border-border">
            <RunDetail run={{ ...RUNS[2], cwd: "/Users/you/code/hz", repo: "hz" }} active onChanged={() => {}} />
          </div>
        </Case>
      )}

      {(!only || only === "failed") && (
        <Case
          title="A read that failed"
          note="The destructive tone, for the kinds where the cure is not a one-line install."
        >
          <InboxView
            tabs={<InboxTabs current="inbox" counts={{ inbox: 9, prs: 6, issues: 3 }} onSelect={() => {}} />}
            items={[]}
            notes={[
              {
                tone: "bad",
                text: "Linear rejected the saved key. Disconnect it in Settings, then paste a new one.",
              },
            ]}
            reading={false}
            refreshing={false}
            onRefresh={() => {}}
            multiRepo={false}
            onOpen={() => {}}
          />
        </Case>
      )}
    </div>
  </React.StrictMode>,
);
