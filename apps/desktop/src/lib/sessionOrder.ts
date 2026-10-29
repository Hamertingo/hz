import { members, type SplitGroup } from "@/lib/groups";
import { projectKey } from "@/lib/project";
import type {
  DelegatedMember,
  Project,
  SessionIndexItem,
  SessionStatus,
} from "@/types/events";

/// One drawn row: the session, how deep it sits, and the flags its connector
/// rails are drawn from.
///
/// **Two species share it.** A row with no `member` is a session; one with a
/// `member` is a delegated subagent hanging off `item` — the session whose agent
/// spawned it. They are one type rather than two lists because the rails are one
/// tree: a subagent sits at `depth + 1` under its parent's own rail, so the walk
/// that orders the list has to know about both to draw them at all.
type SessionListRow = {
  item: SessionIndexItem;
  /// Present on a subagent row, absent on a session row.
  member?: DelegatedMember;
  /// Levels below the top. 0 is a root and draws no connector at all.
  depth: number;
  /// One entry per level *above* this row, saying whether that level's rail
  /// carries on below it. The last entry is this row's own parent — false there
  /// closes the line at the elbow, so a rail never runs on into an unrelated
  /// session.
  guides: boolean[];
  /// This row opens a rail of its own for the rows under it.
  opens: boolean;
};

/// The delegated subagents to draw under one session, in the order they should
/// appear. Absent from every caller that only wants the sessions — the ⌘⇧↑/↓
/// walk among them — which is what keeps the two readings from drifting.
export type SubagentsOf = (sessionId: string) => readonly DelegatedMember[];

/// The order the list is drawn in, with a session spawned by an agent sitting
/// directly under the one that spawned it — and the depth and guide flags each
/// row's rails are drawn from.
///
/// Order and rails come out of this one walk on purpose. Computing the rails
/// separately would let the shape drawn down the left edge disagree with the
/// order the rows are actually in, and a rail pointing at the wrong row says
/// something false about who spawned what.
///
/// A child whose parent is not in `items` is drawn at the top level rather than
/// hidden. That is the ordinary case, not an edge one: the parent may be
/// archived, filtered to another project, or deleted outright, and a row that
/// vanished with it would be unreachable — so it draws as a root, with no rail
/// reaching for a parent that isn't there.
///
/// Depth is drawn rather than flattened: the cap allows a spawned session to
/// spawn, so a grandchild exists, and it hangs off its own parent's rail while
/// that parent still hangs off the root's.
///
/// **A subagent hangs off the same walk.** `subagentsOf` supplies the delegated
/// runs to draw under one session, and they come out one level down, ahead of the
/// sessions it spawned — a subagent is work happening *in* this session, where a
/// spawned session is somewhere else the work went. A caller that passes nothing
/// gets the sessions alone, which is what the keyboard walk wants.
export function sessionRows(
  items: SessionIndexItem[],
  subagentsOf?: SubagentsOf,
): SessionListRow[] {
  const byRecency = (a: SessionIndexItem, b: SessionIndexItem) =>
    Date.parse(b.modified) - Date.parse(a.modified);

  const present = new Set(items.map((i) => i.sessionId));
  const parentOf = (i: SessionIndexItem) =>
    i.parentSessionId && present.has(i.parentSessionId) ? i.parentSessionId : null;

  const children = new Map<string, SessionIndexItem[]>();
  for (const item of items) {
    const parent = parentOf(item);
    if (!parent) continue;
    const group = children.get(parent);
    if (group) group.push(item);
    else children.set(parent, [item]);
  }

  // Depth-first rather than one pass over roots and their direct children: the
  // depth cap allows a spawned session to spawn, so a grandchild exists, and a
  // single pass emitted neither it nor anything below it — the row simply
  // vanished from the sidebar. Pinned by a test.
  const rows: SessionListRow[] = [];
  const seen = new Set<string>();

  const walk = (item: SessionIndexItem, depth: number, guides: boolean[]) => {
    if (seen.has(item.sessionId)) return;
    seen.add(item.sessionId);
    const row: SessionListRow = { item, depth, guides, opens: false };
    rows.push(row);

    // Filtered before the walk, not during it: the last *drawn* child is what
    // closes the rail, and a cycle can leave a listed child already emitted
    // elsewhere — counting it would run the rail on past the row it ends at.
    const kids = (children.get(item.sessionId) ?? [])
      .filter((child) => !seen.has(child.sessionId))
      .sort(byRecency);

    // Everything drawn one level down, subagents first. One list because the
    // parent's rail is one line: `guides` is read by the rails, so a row's "does
    // the level above carry on past me" has to count both species or the line
    // stops at the last spawned session while a subagent still hangs below it.
    const subs = subagentsOf?.(item.sessionId) ?? [];
    const below = subs.length + kids.length;

    const before = rows.length;
    let at = 0;
    for (const member of subs) {
      rows.push({
        item,
        member,
        depth: depth + 1,
        guides: [...guides, at < below - 1],
        opens: false,
      });
      at += 1;
    }
    kids.forEach((child) => {
      walk(child, depth + 1, [...guides, at < below - 1]);
      at += 1;
    });
    row.opens = rows.length > before;
  };

  for (const root of [...items].filter((i) => !parentOf(i)).sort(byRecency)) {
    walk(root, 0, []);
  }

  // A cycle in the index reaches no root, so its rows are still unemitted here.
  // Appended rather than dropped: the sidebar losing a session is worse than
  // drawing a strange order, and `seen` is what stops the walk itself hanging.
  for (const stranded of [...items].sort(byRecency)) {
    walk(stranded, 0, []);
  }

  return rows;
}

/// One run of rows drawn under a single heading, in the order the sidebar draws
/// them.
///
/// Pinned is a kind of its own rather than another path, because it is the one
/// group that spans projects — a path on it could only be a lie or a null, and
/// either leaves the render guessing which sort of group it is holding.
type SessionGroup =
  | { kind: "pinned"; rows: SessionListRow[] }
  | { kind: "group"; id: number; rows: SessionListRow[] }
  | {
      kind: "project";
      projectPath: string;
      state: SessionState;
      rows: SessionListRow[];
    };

/// What a run of rows under a project is waiting on, strongest first.
///
/// Read off the same pair the sidebar rail and the dock badge already draw from
/// — a session held behind a permission card or a question is `asking` even
/// though the backend still reports it `in_progress`, and it is right to: the
/// turn is open, it is only the agent that has stopped.
/// A session mid-turn is deliberately not a state of its own. It is already
/// saying so on its own row — the working indicator sits where the timestamp
/// would be — and a run of its own moved a row twice for one piece of work,
/// out on send and back on the turn ending.
type SessionState = "asking" | "completed" | "idle";

/// Strongest first, which is also the order the runs are drawn in.
const SESSION_STATES: SessionState[] = ["asking", "completed", "idle"];

/// How many rows a project needs before it is split at all.
const STATE_SPLIT_MIN = 3;

/// What the app has heard about every session this run.
///
/// Optional throughout, and its absence is not a default so much as a different
/// question: the settled list asks "what did I finish", where these runs answer
/// "what is happening now". So it passes none, every row comes back `idle`, and
/// the grouping collapses to the one run per project it replaced.
export type LiveSessions = {
  statusBySession: Record<string, SessionStatus>;
  asking: Set<string>;
};

/// Live status wins over the item's own field, which is only as fresh as the
/// last list fetch — but that field is what carries a `completed` across a
/// restart, where the live map is empty.
function sessionState(
  item: SessionIndexItem,
  live?: LiveSessions,
): SessionState {
  if (!live) return "idle";
  if (live.asking.has(item.sessionId)) return "asking";
  const status = live.statusBySession[item.sessionId] ?? item.status;
  return status === "completed" ? "completed" : "idle";
}

/// The items that draw in the Pinned group, and everything else.
///
/// A session is pinned-side when it *or an ancestor* is pinned, so a pinned
/// session's children follow it out of its project's run — leaving them behind
/// would split one nest across two headings and draw children under a parent
/// that isn't there.
///
/// What falls out of that rule: the rest is closed under parentage, since
/// nothing with a pinned ancestor can stay in it. So both halves hold whole
/// nests, and [`sessionRows`] draws each half's own roots at depth 0 — a pinned
/// child whose parent stayed behind reaches the Pinned group as a root, with no
/// rail reaching for a row drawn somewhere else entirely.
function splitPinned(
  items: SessionIndexItem[],
): [pinned: SessionIndexItem[], rest: SessionIndexItem[]] {
  const byId = new Map(items.map((i) => [i.sessionId, i]));

  const underPin = (item: SessionIndexItem) => {
    // Guarded like the walk itself: a cycle in the index has to cost a strange
    // grouping, never a hung sidebar.
    const seen = new Set<string>();
    let at: SessionIndexItem | undefined = item;
    while (at && !seen.has(at.sessionId)) {
      if (at.pinned) return true;
      seen.add(at.sessionId);
      at = at.parentSessionId ? byId.get(at.parentSessionId) : undefined;
    }
    return false;
  };

  const pinned: SessionIndexItem[] = [];
  const rest: SessionIndexItem[] = [];
  for (const item of items) (underPin(item) ? pinned : rest).push(item);
  return [pinned, rest];
}

/// [`sessionRows`] gathered under the project each row's *root* belongs to,
/// with the reader's own pins led out into a group of their own.
///
/// **Pinned leads, whatever the project order says.** It is the one group built
/// by hand, and a pick that sorted in with the rest would be no easier to find
/// than the rows it was made out of. It spans projects besides, so there is no
/// place in that order for it to take. A pinned session draws there and nowhere
/// else — drawn twice, the reader has to work out which copy is the one they
/// pinned.
///
/// A project filter needs nothing here: the caller narrows `items` before this
/// sees them, so the Pinned group holds that project's pins alone and opens no
/// group at all when it holds none.
///
/// Grouped on the root rather than on the row: a spawned session hangs off its
/// parent wherever its own `projectPath` points, and splitting one nest across
/// two headings would draw a child under a parent that isn't there.
///
/// A project with no session opens no group, which is the whole of "don't show
/// an empty project" — headings come from the sessions present, never from the
/// attached list.
///
/// **Group order is the project list's own**, not the recency of the sessions
/// inside it. Ordering on the newest session read well for one screenshot and
/// badly in use: every reply to any session lifted its whole project over the
/// others, so headings the eye had learned the position of moved while a turn
/// was running. The project list only reorders when a project is *selected*,
/// which is the reader's own act. A project no longer attached still has
/// sessions to draw, so it keeps first-appearance order after the attached
/// ones.
///
/// **Each project's run then splits again by what its sessions are waiting on**
/// — needs attention, completed, idle — in that order, which is the
/// order the reader can act on them in. Under the project rather than over it:
/// the question "what is happening" is asked of one repo at a time, and a
/// workspace-wide "Needs attention" run would put two repos' rows in one place
/// and leave every project heading below it describing only what is left.
///
/// Rows inside a run stay newest-first, and a nest stays whole under its own
/// root. Recency alone no longer orders a project, though — the runs do, so a
/// session that has just finished sits above an idle one modified since.
///
/// **A subagent travels with the session that spawned it**, wherever that
/// session lands: same project, same state run, same nest. It is read through
/// `subagentsOf` rather than carried in `items` because it is not a session —
/// it has no project of its own to be grouped by, and the two readings only ever
/// agree if they come from one place.
export function sessionGroups(
  items: SessionIndexItem[],
  projects: Project[] = [],
  live?: LiveSessions,
  settled = false,
  splits: SplitGroup[] = [],
  subagentsOf?: SubagentsOf,
): SessionGroup[] {
  // A split group is drawn as its own run, in grid order, and its members
  // nowhere else — not under their project, not under Pinned. Rows only, no
  // rails: a member's children stay under the project, since dragging a parent
  // into a grid did not open its children there. Pulled out first, so a pinned
  // member draws in its group rather than twice.
  const byId = new Map(items.map((i) => [i.sessionId, i]));
  const inSplit = new Set(splits.flatMap((g) => members(g)));
  const splitRuns: SessionGroup[] = splits.flatMap((g) => {
    const rows = members(g)
      .map((id) => byId.get(id))
      .filter((i): i is SessionIndexItem => Boolean(i))
      .map((item) => ({ item, depth: 0, guides: [], opens: false }));
    return rows.length ? [{ kind: "group" as const, id: g.id, rows }] : [];
  });
  const ungrouped = items.filter((i) => !inSplit.has(i.sessionId));

  // A pin is what the reader keeps in reach while they work, so it says nothing
  // in a history — every row there is already done with. Settled draws its pins
  // under their own projects like any other row.
  const [pinned, rest] = settled ? [[], ungrouped] : splitPinned(ungrouped);

  // Every subtree the walk emits opens with its own root, so a depth-0 row is
  // where one nest ends and the next begins.
  const nests: SessionListRow[][] = [];
  for (const row of sessionRows(rest, subagentsOf)) {
    if (row.depth === 0 || nests.length === 0) nests.push([]);
    nests[nests.length - 1].push(row);
  }

  // A nest takes the strongest state anything in it holds, so a child blocked on
  // a question carries its parent up with it. Ranking on the root alone would
  // leave the run that says "these want you" silent about the only session in it
  // that does.
  // Subagent rows carry their parent's own `item`, so reading them here would
  // count that session's state a second time — harmless for a minimum, and
  // skipped so the rule stays "a nest's state is its sessions'".
  const nestState = (nest: SessionListRow[]) =>
    SESSION_STATES[
      Math.min(
        ...nest
          .filter((row) => !row.member)
          .map((row) => SESSION_STATES.indexOf(sessionState(row.item, live))),
      )
    ];

  // First appearance, which is what an unattached project is placed by.
  //
  // Keyed by the project a session *belongs to* rather than by the path it
  // recorded, so a workspace's repositories sit under one heading. A session in
  // a project that is itself a repository keys to that same path — the rule's
  // fallback is the identity — so nothing about the list moves for one.
  const byPath = new Map<string, SessionListRow[][]>();
  for (const nest of nests) {
    const path = projectKey(projects, nest[0].item.projectPath);
    const held = byPath.get(path);
    if (held) held.push(nest);
    else byPath.set(path, [nest]);
  }

  type ProjectGroup = Extract<SessionGroup, { kind: "project" }>;
  const groups: ProjectGroup[] = [];

  for (const [projectPath, held] of byPath) {
    const rows = held.reduce((n, nest) => n + nest.length, 0);

    // A short project draws as one run. The split earns its break by making a
    // long list quicker to scan, and there is nothing to scan in two rows — the
    // reader's eye already holds the whole project, so a gap through it only
    // says the app found the rows worth separating when it didn't.
    if (rows < STATE_SPLIT_MIN) {
      groups.push({
        kind: "project",
        projectPath,
        state: nestState(held.flat()),
        rows: held.flat(),
      });
      continue;
    }

    const byState = new Map<SessionState, ProjectGroup>();
    const made: ProjectGroup[] = [];
    for (const nest of held) {
      const state = nestState(nest);
      let group = byState.get(state);
      if (!group) {
        group = { kind: "project", projectPath, state, rows: [] };
        byState.set(state, group);
        made.push(group);
      }
      group.rows.push(...nest);
    }

    // A run of one row between two breaks reads as a heading rather than as a
    // row. Where both marked runs are a single row they share one break: the
    // pair says "these want you" either way, and the marks themselves — yellow
    // against green — are what tell the two apart.
    const asking = byState.get("asking");
    const completed = byState.get("completed");
    if (asking?.rows.length === 1 && completed?.rows.length === 1) {
      asking.rows.push(...completed.rows);
      made.splice(made.indexOf(completed), 1);
    }

    groups.push(...made);
  }

  const seenPath = new Map([...byPath.keys()].map((path, i) => [path, i]));

  // Unattached sorts to the end rather than to the front, keeping the order it
  // was built in — hence first appearance rather than one shared sentinel, which
  // would let two unattached projects interleave through each other's runs.
  const rank = new Map(projects.map((p, i) => [p.path, i]));
  const place = (group: ProjectGroup) =>
    rank.get(group.projectPath) ??
    projects.length + (seenPath.get(group.projectPath) ?? 0);

  groups.sort(
    (a, b) =>
      place(a) - place(b) ||
      SESSION_STATES.indexOf(a.state) - SESSION_STATES.indexOf(b.state),
  );

  const pinnedRows = sessionRows(pinned, subagentsOf);
  return [
    ...splitRuns,
    ...(pinnedRows.length ? [{ kind: "pinned" as const, rows: pinnedRows }] : []),
    ...groups,
  ];
}

/// The order alone, for callers that only step through it.
///
/// Exported because the ⌘⇧↑/↓ shortcut walks the same sequence, and a second
/// comparator would let the two disagree about which row is "next" — worse when
/// the sidebar is collapsed and nothing on screen shows the order being walked.
/// Grouped for the same reason: the shortcut has to step past a heading the way
/// the eye does, so it takes the same project list the headings are ordered by —
/// and it steps the pins first, because that is where the eye starts too. Live
/// status rides along for the same reason: a session that just finished moves
/// into its own run on screen, and a walk reading it where it used to be would
/// step past the row the reader is looking at.
export function sortSessions(
  items: SessionIndexItem[],
  projects: Project[] = [],
  live?: LiveSessions,
  settled = false,
  splits: SplitGroup[] = [],
): SessionIndexItem[] {
  return sessionGroups(items, projects, live, settled, splits).flatMap((group) =>
    group.rows.map((row) => row.item),
  );
}

/// That same order with each *heading's* run folded into one step, for the
/// chord that walks headings rather than rows.
///
/// The unit is what the reader sees a heading over: a split group, the Pinned
/// run, or a project. A project's state runs fold back together because they
/// draw under one heading — stepping into "Completed" inside the project the
/// reader is already in is not the jump the chord promises.
///
/// Keyed rather than counted, since the runs of one project are consecutive by
/// construction and nothing else should ever fold.
export function sessionUnits(
  items: SessionIndexItem[],
  projects: Project[] = [],
  live?: LiveSessions,
  settled = false,
  splits: SplitGroup[] = [],
): SessionIndexItem[][] {
  const key = (group: SessionGroup) =>
    group.kind === "project"
      ? `p${group.projectPath}`
      : group.kind === "group"
        ? `g${group.id}`
        : "pinned";

  const units: SessionIndexItem[][] = [];
  let last: string | null = null;
  for (const group of sessionGroups(items, projects, live, settled, splits)) {
    const rows = group.rows.map((row) => row.item);
    if (key(group) === last) units[units.length - 1].push(...rows);
    else units.push(rows);
    last = key(group);
  }
  return units;
}

/// The rows a query leaves on screen, matched on `title` alone.
///
/// Applied *before* grouping, so a heading only draws where a group still holds
/// a row, and before `sortSessions` flattens the result, so ⌘⇧↑/↓ steps exactly
/// the rows drawn.
///
/// That ordering is what settles the pins too, and it needs no code of its own:
/// [`splitPinned`] sees the narrowed list, so a pin that matches stays in the
/// Pinned group and one that doesn't goes with every other row that didn't
/// match. Moving a matching pin down into its project's run would say the pin
/// had been dropped, and which rows the reader chose is the one thing that
/// group exists to say.
///
/// Substring and case-insensitive, deliberately no more than that. Fuzzy
/// matching ranks, and a ranked list cannot stay in the recency order the rails
/// are drawn from — a child would sit under whatever scored above it rather
/// than under its parent. The titles here are one line of the reader's own
/// words, so a substring finds them.
///
/// A blank query hands the same array back, identity included, so the memo over
/// this holds while nothing is being searched for.
///
/// Narrows what is already on screen: the caller passes the list `projectFilter`
/// and the active/settled split have already scoped, and search never reaches
/// past either.
export function filterSessions(
  items: SessionIndexItem[],
  query: string,
): SessionIndexItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.title.toLowerCase().includes(needle));
}

/// Whether a row has a parent to detach from, judged the same way
/// [`sessionRows`] places it — a parent that isn't on screen means the row is
/// drawn at the top level, so the menu item can never offer to cut a link the
/// list doesn't draw.
export function isNested(item: SessionIndexItem, items: SessionIndexItem[]): boolean {
  return Boolean(
    item.parentSessionId && items.some((i) => i.sessionId === item.parentSessionId),
  );
}
