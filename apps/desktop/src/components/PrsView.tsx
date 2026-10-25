import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CircleCheck,
  CircleX,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Plus,
  RefreshCw,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type MutableRefObject, type ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import Avatar from "@/components/Avatar";
import { diffClass } from "@/components/chat/ChatSheets";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import Spinner from "@/components/ui/spinner";
import PrPanel from "@/components/PrPanel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import Tab from "@/components/Tab";
import { prKey, describe as describeError, usePrList, type PrRow } from "@/hooks/usePrList";
import { runPrAction, usePullRequest, type PrAction } from "@/hooks/usePullRequest";
import { relativeTime } from "@/lib/format";
import { attributeAgent, boardLanes, type AgentBranch, type PrLane } from "@/lib/prBoard";
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
  const { items, viewer, error, failed, loading, refresh, invalidate } = usePrList(
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
  const shown = useMemo(
    () => (agentFilter === "all" ? open : open.filter((pr) => agentOf.get(prKey(pr)) === agentFilter)),
    [open, agentFilter, agentOf],
  );
  const lanes = useMemo(() => boardLanes(shown, viewer), [shown, viewer]);

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
      <div className="flex min-h-0 flex-1 flex-col">
        <Empty>
          {error?.kind === "no_remote"
            ? prUnavailableText(error, cwds[0])
            : "Attach a project with a GitHub remote to see its pull requests here."}
        </Empty>
      </div>
    );
  }

  const firstRead = loading && !items.length;

  const board = (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-ui font-medium">
            <GitPullRequest className="size-4" /> Pull requests
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto cursor-pointer">
            Close
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <AuthorChip label="All" count={open.length} active={agentFilter === "all"} onClick={() => setAgentFilter("all")} />
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
          <Button
            variant="outline"
            size="sm"
            className="ml-auto cursor-pointer text-muted-foreground"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{prUnavailableText(error, cwds[0])}</span>
        </div>
      )}
      {failed && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-ui text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">
            {failed.count} of {cwds.length} repositories could not be read — {failed.detail}
          </span>
        </div>
      )}

      {firstRead ? (
        <BoardSkeleton />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-hidden p-5 md:grid-cols-3">
          {LANES.map((lane) => (
            <Lane key={lane.key} title={lane.title} sub={lane.sub} empty={lane.empty} count={lanes[lane.key].length}>
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
    </div>
  );

  return board;
}

const LANES: { key: PrLane; title: string; sub: string; empty: string }[] = [
  { key: "you", title: "Needs you", sub: "Review or approve", empty: "Nothing waiting on you" },
  { key: "work", title: "Agents working", sub: "Still being written or checked", empty: "No agent is mid-PR" },
  { key: "ready", title: "Ready to merge", sub: "Approved, checks green", empty: "Nothing ready yet" },
];

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
  title,
  sub,
  empty,
  count,
  children,
}: {
  title: string;
  sub: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  const none = count === 0;
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card/40 px-3 pt-3.5 pb-3">
      <div className="flex items-center gap-2 px-1">
        <b className="text-ui font-semibold">{title}</b>
        <span className="tabular-nums text-ui text-muted-foreground">{count}</span>
      </div>
      <div className="px-1 pt-0.5 pb-3 text-ui text-muted-foreground">{sub}</div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {none ? <div className="px-2.5 py-7 text-center text-ui text-muted-foreground">{empty}</div> : children}
      </div>
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
      className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-hidden p-5 md:grid-cols-3"
    >
      {LANES.map((lane, l) => (
        <section key={lane.key} className="flex min-h-0 flex-col rounded-xl border border-border bg-card/40 px-3 pt-3.5 pb-3">
          <div className="flex items-center gap-2 px-1">
            <b className="text-ui font-semibold">{lane.title}</b>
          </div>
          <div className="px-1 pt-0.5 pb-3 text-ui text-muted-foreground">{lane.sub}</div>
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
  const tint = agent?.color ?? "var(--muted-foreground)";
  const Icon: LucideIcon = pr.isDraft ? GitPullRequestDraft : GitPullRequest;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative w-full cursor-pointer overflow-hidden rounded-lg bg-background px-3.5 py-3 text-left shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors hover:bg-sidebar-accent/40"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 opacity-80" style={{ background: tint }} />
      <div className="flex items-center gap-1.5 text-ui text-muted-foreground">
        <Icon className="size-3.5" />
        <span>
          {pr.repo} #{pr.number}
        </span>
        {pr.isDraft && <Tag>Draft</Tag>}
        {pr.reviewDecision === "CHANGES_REQUESTED" && <Tag tone="amber">Changes requested</Tag>}
        <span className="ml-auto shrink-0 text-muted-foreground/70">{relativeTime(pr.createdAt)}</span>
      </div>
      <div className="mt-1.5 text-ui font-medium leading-snug">{pr.title}</div>
      <div className="mt-2.5 flex items-center gap-2.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 text-foreground/80">
          {agent ? (
            <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={18} />
          ) : (
            <Avatar src={pr.avatar} name={pr.author} className="size-[18px]" />
          )}
          {agent ? agent.name : pr.author}
        </span>
        <span className="tabular-nums">
          <b className="font-medium text-green">+{pr.additions}</b> <i className="not-italic text-red">−{pr.deletions}</i>
        </span>
        <span>
          {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
        </span>
      </div>
      <div className="mt-2.5 flex items-center border-t border-border pt-2.5">
        <ChecksLine state={pr.checksState} />
        {pr.reviewRequests.length > 0 && (
          <span className="ml-auto flex -space-x-1">
            {pr.reviewRequests.slice(0, 3).map((login) => (
              <Avatar key={login} src={null} name={login} className="size-[18px] ring-2 ring-background" />
            ))}
          </span>
        )}
      </div>
    </button>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone?: "amber" }) {
  return (
    <span
      className={cn(
        "rounded-full border border-border px-1.5 py-px text-[11px]",
        tone === "amber" && "text-accent-command",
      )}
    >
      {children}
    </span>
  );
}

function ChecksLine({ state }: { state: PrListItem["checksState"] }) {
  if (state === "RUNNING") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        Checks running
      </span>
    );
  }
  if (state === "FAILING") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
        <CircleX className="size-3.5" />
        Checks failing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-accent-add">
      <CircleCheck className="size-3.5" />
      Checks passing
    </span>
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
