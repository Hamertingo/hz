import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CircleCheck,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Plus,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState, type MutableRefObject, type ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import Avatar from "@/components/Avatar";
import { diffClass } from "@/components/chat/ChatSheets";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import PrPanel from "@/components/PrPanel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageSheet } from "@/components/ui/page-sheet";
import { Sheet } from "@/components/ui/sheet";
import Tab from "@/components/Tab";
import { toast } from "@/components/ui/toast";
import { prKey, describe as describeError, usePrList, type PrRow } from "@/hooks/usePrList";
import { runPrAction, usePullRequest, type PrAction } from "@/hooks/usePullRequest";
import { attributeAgent, type AgentBranch } from "@/lib/prBoard";
import { prUnavailableText } from "@/lib/unavailable";
import { useRoster, type RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { PrListItem } from "@/types/events";

/// The repositories' open pull requests as a board: who is waiting on whom.
///
/// **Three lanes, and the lane is the answer to "whose move is it".** A review
/// asked of the reader comes first; work the agents still owe comes second; what
/// is approved and green is ready to land. The lanes are read from the same list
/// the rest of the app reads, so a card here and a sidebar mark never disagree
/// about a pull request's state.
///
/// **Attribution is by branch, not by a stored link.** A pull request belongs to
/// the agent whose session works on the branch it was opened from, in the same
/// repository. Nothing is written anywhere to make that true; the roster already
/// says which session is which agent.
export default function PrsView({
  cwds,
  active,
  onClose,
  refreshRef,
  agentBranches,
  onAskAgent,
  onWrite,
}: {
  /// The repositories to list, in the order the app knows them.
  cwds: string[];
  active: boolean;
  onClose: () => void;
  /// The page's refresh, handed up so ⌘R and a write made in the sheet can reach
  /// it. The page owns the read; the rest of the app only presses a button.
  refreshRef?: MutableRefObject<(() => void) | null>;
  /// Which agent's session works on which branch, for attribution.
  agentBranches: readonly AgentBranch[];
  /// Sends words into an agent's chat, for "Ask an agent to review".
  onAskAgent: (agentId: string, text: string) => void;
  /// Called after a write that changes what the sidebar marks should say.
  onWrite: () => void;
}) {
  const roster = useRoster();

  /// `all` is the state the launch prefetch fills, so the board costs no read
  /// the app was not already paying for. Only open rows reach the lanes.
  const { items, error, failed, loading, refresh, invalidate } = usePrList(
    cwds,
    active,
    "all",
    "",
  );

  /// The agent filter: `all`, or an agent id. Faces, not a menu, as the mockup has it.
  const [agentFilter, setAgentFilter] = useState<string>("all");
  /// The open pull request whose sheet is up, by key so a refresh keeps it current.
  const [sheetKey, setSheetKey] = useState<string | null>(null);

  const agentOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const pr of items) map.set(prKey(pr), attributeAgent(pr, agentBranches) ?? "");
    return map;
  }, [items, agentBranches]);

  const open = useMemo(() => items.filter((pr) => pr.state === "OPEN"), [items]);
  const onBoard = useMemo(() => items.filter((pr) => pr.state === "OPEN" || pr.state === "MERGED"), [items]);
  const shown = useMemo(
    () => (agentFilter === "all" ? onBoard : onBoard.filter((pr) => agentOf.get(prKey(pr)) === agentFilter)),
    [onBoard, agentFilter, agentOf],
  );
  const lanes = useMemo(() => {
    const out: Record<BoardLane, PrRow[]> = { open: [], review: [], merged: [] };
    for (const pr of shown) out[laneOf(pr)].push(pr);
    return out;
  }, [shown]);

  // The faces in the filter row: agents that have at least one open pull request.
  const authors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pr of open) {
      const id = agentOf.get(prKey(pr));
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return roster.agents
      .filter((a) => counts.has(a.id))
      .map((a) => ({ agent: a, count: counts.get(a.id) ?? 0 }));
  }, [open, agentOf, roster.agents]);

  const sheetRow = sheetKey ? (items.find((pr) => prKey(pr) === sheetKey) ?? null) : null;
  const sheetAgent = sheetRow ? rosterAgent(roster.agents, agentOf.get(prKey(sheetRow))) : null;

  // Published rather than called, so ⌘R reaches whichever body is up.
  if (refreshRef) refreshRef.current = invalidate;

  // A project that is a scratch folder, or a workspace holding repositories, is
  // the page having nothing to list. Said in quiet words, not as a failure.
  if (!cwds.length || error?.kind === "no_remote") {
    return (
      <PageSheet active={active} title="Pull requests" onClose={onClose}>
        <Empty>
          {error?.kind === "no_remote"
            ? prUnavailableText(error, cwds[0])
            : "Attach a project with a GitHub remote to see its pull requests here."}
        </Empty>
      </PageSheet>
    );
  }

  const firstRead = loading && !items.length;

  const board = (
    <PageSheet
      active={active}
      title="Pull requests"
      onClose={onClose}
      actions={
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-4 pb-5">
        {authors.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <AuthorChip label="All" count={onBoard.length} active={agentFilter === "all"} onClick={() => setAgentFilter("all")} />
            {authors.map(({ agent, count }) => (
              <AuthorChip
                key={agent.id}
                label={agent.name}
                count={count}
                active={agentFilter === agent.id}
                onClick={() => setAgentFilter(agent.id)}
                face={<AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={16} />}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">{prUnavailableText(error, cwds[0])}</span>
          </div>
        )}
        {failed && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-ui text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">
              {failed.count} of {cwds.length} repositories could not be read — {failed.detail}
            </span>
          </div>
        )}

        {firstRead ? (
          <BoardSkeleton />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-3 gap-2.5 max-[760px]:grid-cols-1">
            {LANES.map((lane) => (
              <Lane key={lane.key} dot={lane.dot} title={lane.title} empty={lane.empty} count={lanes[lane.key].length}>
                {lanes[lane.key].map((pr) => (
                  <PrCard
                    key={prKey(pr)}
                    pr={pr}
                    agent={rosterAgent(roster.agents, agentOf.get(prKey(pr)))}
                    onOpen={() => setSheetKey(prKey(pr))}
                  />
                ))}
              </Lane>
            ))}
          </div>
        )}
      </div>

      <span className="sr-only" role="status">
        {open.length} open pull requests
      </span>

      {sheetRow && (
        <PrSheet
          key={prKey(sheetRow)}
          pr={sheetRow}
          agent={sheetAgent}
          agents={roster.agents}
          onClose={() => setSheetKey(null)}
          onChanged={invalidate}
          onWrite={onWrite}
          onAskAgent={onAskAgent}
        />
      )}
    </PageSheet>
  );

  return board;
}

type BoardLane = "open" | "review" | "merged";

const LANES: { key: BoardLane; title: string; empty: string; dot: string }[] = [
  { key: "open", dot: "bg-blue", title: "Open", empty: "Nothing here." },
  { key: "review", dot: "bg-amber", title: "In review", empty: "Nothing here." },
  { key: "merged", dot: "bg-green", title: "Merged", empty: "Nothing here." },
];

/// Open and waiting for anyone to look; open with a review asked or given; settled. The board
/// is the picture of where each pull request is in its life, not of whose move it is.
function laneOf(pr: PrListItem): BoardLane {
  if (pr.state === "MERGED") return "merged";
  return pr.reviewDecision || pr.reviewRequests.length > 0 ? "review" : "open";
}

function rosterAgent(agents: readonly RosterAgent[], id: string | undefined): RosterAgent | null {
  if (!id) return null;
  return agents.find((a) => a.id === id) ?? null;
}

function AuthorChip({
  label,
  count,
  active,
  onClick,
  face,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  face?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-ui transition-colors",
        active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/50",
      )}
    >
      {face}
      {label}
      <span className="tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function Lane({
  dot,
  title,
  empty,
  count,
  children,
}: {
  dot: string;
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col gap-1.5 overflow-y-auto rounded-(--r3) bg-s1 px-2 pt-2.5 pb-2 scrollbar-none">
      <h4 className="flex items-center gap-[7px] px-1.5 pt-0.5 pb-1 text-[12.5px] leading-normal font-medium">
        <i aria-hidden className={cn("size-1.5 rounded-full", dot)} />
        {title}
        <i className="font-normal not-italic text-ink4">{count}</i>
      </h4>
      <div className="flex flex-col gap-2">{count === 0 ? <div className="px-2.5 py-7 text-center text-[12.5px] text-ink3">{empty}</div> : children}</div>
    </section>
  );
}

/// The board's own outline while the first read runs: the three lanes with their
/// heading, their line of sub-text and a few cards, each with its repo line, a
/// title and an author row.
function BoardSkeleton() {
  return (
    <SkeletonRegion
      label="Reading this repository's pull requests"
      className="grid min-h-0 flex-1 grid-cols-3 gap-2.5"
    >
      {LANES.map((lane, l) => (
        <section key={lane.key} className="flex min-h-0 flex-col rounded-[13px] px-3 pt-3.5 pb-3 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="flex items-center gap-2 px-1">
            <b className="text-ui font-semibold">{lane.title}</b>
          </div>
                  <div className="flex flex-col gap-2">
            {Array.from({ length: 3 - l }, (_, i) => (
              <div key={i} className="rounded-lg bg-background px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-border)]">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="size-3.5" />
                  <Skeleton className="h-2.5 w-24" />
                  <Skeleton className="ml-auto h-2.5 w-8" />
                </div>
                <Skeleton className="mt-2.5 h-3 w-4/5" />
                <div className="mt-3 flex items-center gap-2">
                  <Skeleton className="size-4 rounded-full" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </SkeletonRegion>
  );
}

function PrCard({
  pr,
  agent,
  onOpen,
}: {
  pr: PrRow;
  agent: RosterAgent | null;
  onOpen: () => void;
}) {
  const ck = pr.checksState === "RUNNING" ? ["Running", "bg-amber"] : pr.checksState === "FAILING" ? ["Failing", "bg-red"] : ["Passing", "bg-green"];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full cursor-pointer rounded-(--r2) bg-background px-3 py-[11px] text-left shadow-[inset_0_0_0_1px_var(--line)] transition-shadow outline-none hover:shadow-[inset_0_0_0_1px_var(--line2)] focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="block text-[11.5px] leading-normal text-ink3">
        {pr.repo} #{pr.number}
        {pr.isDraft && <> · Draft</>}
      </span>
      <b className="mt-0.5 block text-[13px] leading-[1.4] font-medium">{pr.title}</b>
      <div className="mt-[9px] flex items-center gap-2 text-[11.5px] leading-normal text-ink3">
        {agent ? (
          <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} size={16} />
        ) : (
          <Avatar src={pr.avatar} name={pr.author} className="size-4" />
        )}
        <span className="tabular-nums">
          <b className="font-medium text-green">+{pr.additions}</b> <em className="not-italic text-red">−{pr.deletions}</em>
        </span>
        <span className="ml-auto inline-flex items-center gap-[5px]">
          <i className={cn("size-1.5 rounded-full", ck[1])} />
          {ck[0]}
        </span>
      </div>
    </button>
  );
}

/// The pull request sheet: the agent's note, the diff, then everything `PrPanel`
/// already does (checks, description, comments, reviewers, merge) as sections.
///
/// **Merge goes through here, not through `PrPanel`'s own button, so the Undo
/// toast can follow it.** `usePullRequest.act` resolves even when the write fails
/// (the failure is written into its state), so the success it would report cannot
/// be told apart from the failure. `runPrAction` throws, and that is the signal.
function PrSheet({
  pr,
  agent,
  agents,
  onClose,
  onChanged,
  onWrite,
  onAskAgent,
}: {
  pr: PrRow;
  agent: RosterAgent | null;
  agents: readonly RosterAgent[];
  onClose: () => void;
  onChanged: () => void;
  onWrite: () => void;
  onAskAgent: (agentId: string, text: string) => void;
}) {
  const data = usePullRequest(pr.cwd, pr.headRefName, true, undefined, onChanged);
  const [confirming, setConfirming] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    invoke<string>("pr_diff", { cwd: pr.cwd, number: pr.number })
      .then((d) => live && setDiff(d))
      .catch(() => live && setDiff(""));
    return () => {
      live = false;
    };
  }, [pr.cwd, pr.number]);

  const act = async (number: number, action: PrAction): Promise<void> => {
    if (action.kind !== "merge") return data.act(number, action);
    try {
      await runPrAction(pr.cwd, number, action);
      onWrite();
      onChanged();
      onClose();
      toast(`Merged #${number} into ${pr.baseRefName}`, {
        icon: <GitMerge className="size-3.5" />,
        ms: 8000,
        action: { label: "Undo", onClick: () => void undoMerge(pr.cwd, number) },
      });
    } catch (e) {
      toast(`Could not merge #${number}: ${describeError(e)}`, { ms: 6000 });
    }
  };

  const mergeBlocked = pr.checksState !== "CLEAR" || pr.mergeable === "CONFLICTING";
  const files = diff ? splitDiff(diff) : null;

  return (
    <>
      <Sheet
        open
        onOpenChange={(o) => !o && onClose()}
        mode="centered"
        width={880}
        title={`#${pr.number} ${pr.title}`}
        sub={`${pr.repo} · ${pr.headRefName} → ${pr.baseRefName}`}
        icon={<GitPullRequest className="size-3.5" />}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => void openUrl(pr.url)}>
              <ExternalLink /> Open on GitHub
            </Button>
            {agent && (
              <Button variant="ghost" size="sm" onClick={() => onAskAgent(agent.id, `About PR #${pr.number}: `)}>
                Ask {agent.name}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Plus /> Ask an agent to review
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {agents.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    onSelect={() => onAskAgent(a.id, `Review PR #${pr.number} in ${pr.repo}: ${pr.url}`)}
                  >
                    {a.name}
                  </DropdownMenuItem>
                ))}
                {agents.length === 0 && <DropdownMenuItem disabled>No agents yet</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={data.acting || pr.reviewDecision === "APPROVED"}
                onClick={() => void act(pr.number, { kind: "review", number: pr.number, verdict: "approve", body: "" })}
              >
                <CircleCheck /> {pr.reviewDecision === "APPROVED" ? "Approved" : "Approve"}
              </Button>
              <Button
                size="sm"
                disabled={data.acting || mergeBlocked}
                title={mergeBlocked ? "Checks must pass and the branch must not conflict" : undefined}
                onClick={() => setConfirming(true)}
              >
                <GitMerge /> Merge
              </Button>
            </div>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="rounded-lg bg-background px-3.5 py-3 text-ui text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]">
            {agent ? (
              <span className="inline-flex items-center gap-2">
                <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={22} />
                <span>
                  <b className="text-foreground">{agent.name}</b> opened this from{" "}
                  <code className="font-mono text-xs">{pr.headRefName}</code>.
                </span>
              </span>
            ) : (
              <span>
                Opened by <b className="text-foreground">{pr.author}</b> on GitHub.
              </span>
            )}
          </div>

          <section className="flex flex-col gap-2">
            <h4 className="flex items-center justify-between text-ui font-medium">
              Changes
              <span className="tabular-nums text-muted-foreground">
                <span className="text-green">+{pr.additions}</span> <span className="text-red">−{pr.deletions}</span>{" "}
                in {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
              </span>
            </h4>
            {files === null ? (
              <SkeletonRegion label="Reading the diff" className="flex flex-col gap-2">
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
                    <Skeleton className="size-3.5" />
                    <Skeleton className={i ? "h-3 w-36" : "h-3 w-52"} />
                    <Skeleton className="ml-auto h-3 w-14" />
                  </div>
                ))}
              </SkeletonRegion>
            ) : files.length === 0 ? (
              <p className="text-ui text-muted-foreground">No diff to show.</p>
            ) : (
              files.map((file, i) => <FileDiff key={file.path} path={file.path} lines={file.lines} open={i < 3} />)
            )}
          </section>

          <PrPanel {...data} act={act} branch={pr.headRefName} cwd={pr.cwd} only={pr.number} />
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Merge #${pr.number}?`}
        description={`${pr.title} goes into ${pr.baseRefName} on ${pr.repo}. It is squashed into one commit. Undo opens a revert pull request.`}
        confirmLabel="Merge"
        danger={false}
        onConfirm={() => {
          setConfirming(false);
          void act(pr.number, { kind: "merge", method: "squash" });
        }}
      />
    </>
  );
}

/// Opens a revert of a merged pull request. Named here rather than in the toast
/// so the toast can show the outcome, and the PR it opens is the reader's to read.
async function undoMerge(cwd: string, number: number): Promise<void> {
  try {
    const url = await invoke<string>("revert_pr", { cwd, number });
    toast(`Opened a revert of #${number}`, {
      icon: <Undo2 className="size-3.5" />,
      ms: 8000,
      action: { label: "Open", onClick: () => void openUrl(url) },
    });
  } catch (e) {
    toast(`Could not revert #${number}: ${describeError(e)}`, { ms: 6000 });
  }
}

/// Splits a unified diff into one entry per file, keeping each file's lines.
export function splitDiff(diff: string): { path: string; lines: string[] }[] {
  const files: { path: string; lines: string[] }[] = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      current = { path: match?.[2] ?? line, lines: [] };
      files.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return files;
}

/// Past this many lines a file says it was cut, rather than mounting thousands of rows.
const MAX_FILE_LINES = 400;

function FileDiff({ path, lines, open }: { path: string; lines: string[]; open: boolean }) {
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const shown = lines.slice(0, MAX_FILE_LINES);
  return (
    <details open={open} className="rounded-lg shadow-[inset_0_0_0_1px_var(--color-border)]">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-ui">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
        <span className="shrink-0 tabular-nums text-xs">
          <span className="text-green">+{added}</span> <span className="text-red">−{removed}</span>
        </span>
      </summary>
      <pre className="overflow-x-auto border-t border-border font-mono text-xs leading-5">
        {shown.map((line, i) => (
          <div key={i} className={cn("whitespace-pre px-3", diffClass(line))}>
            {line || " "}
          </div>
        ))}
        {lines.length > MAX_FILE_LINES && (
          <div className="px-3 py-1 text-muted-foreground">
            … {lines.length - MAX_FILE_LINES} more lines on GitHub.
          </div>
        )}
      </pre>
    </details>
  );
}

/// The pull request in `App`'s right pane, for a pull request opened there. The
/// board opens the sheet instead; this stays for the pane's own tabs.
export function PrDetail({
  picked,
  active,
  onChanged,
}: {
  picked: PrRow | null;
  active: boolean;
  onChanged: () => void;
}) {
  const data = usePullRequest(picked?.cwd ?? "", picked?.headRefName ?? null, active && !!picked, undefined, onChanged);

  if (!picked) {
    return <Empty>Choose a pull request to see its checks, its conversation and the buttons that act on it.</Empty>;
  }

  return <PrPanel {...data} branch={picked.headRefName} cwd={picked.cwd} only={picked.number} />;
}

/// The pull requests the reader has open in `App`'s right pane, as a strip of tabs.
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

/// A read with nothing behind it yet, or the page having nothing to list.
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-72 flex-col items-center gap-2.5 text-center">
        <GitPullRequest className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
        <p className="text-balance text-ui text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
