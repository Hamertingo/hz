import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ExternalLink, FileText, GitPullRequest, Pencil, Download, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import { Markdown } from "@/components/chat/Markdown";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";
import { appendToDraft } from "@/hooks/useDraft";
import { closeSheet, useChatSheet, type ChatSheet } from "@/lib/chatSheets";
import { focusComposer } from "@/lib/composerFocus";
import { openFile } from "@/lib/openWith";
import { useRoster, type RosterAgent } from "@/lib/roster";
import { EMPTY_SCREEN, feed, screenText, stripAnsi, type Screen } from "@/lib/termScreen";
import { toolArgument } from "@/lib/tools";
import { cn } from "@/lib/utils";
import type { PrListItem } from "@/types/events";

type Props = {
  sessionId: string | null;
  /// Whether the agent is mid-turn, for the terminal's "stop it first".
  busy: boolean;
  onStop: () => void;
  onRespond: (sessionId: string, requestId: string, optionId: string) => void;
};

/// Whichever panel the chat has open beside it. One component for all five so the
/// transcript opens a card with a single call and exactly one is ever up.
export default function ChatSheets({ sessionId, busy, onStop, onRespond }: Props) {
  const sheet = useChatSheet();
  const roster = useRoster();
  if (!sheet) return null;

  switch (sheet.kind) {
    case "file":
      return <FileSheet sheet={sheet} sessionId={sessionId} agent={roster.agents.find((a) => a.id === sheet.agentId)} />;
    case "pr":
      return <PrSheet sheet={sheet} cwd={cwdOf(roster.agents, sheet.agentId)} />;
    case "exchange":
      return <ExchangeSheet sheet={sheet} agents={roster.agents} />;
    case "thread":
      // Drawn over the chat column instead, as a chat of its own: `ThreadView`.
      return null;
    case "approval":
      return <ApprovalSheet sheet={sheet} sessionId={sessionId} onRespond={onRespond} />;
    case "terminal":
      return (
        <TerminalSheet
          sheet={sheet}
          agent={roster.agents.find((a) => a.id === sheet.agentId)}
          busy={busy}
          onStop={onStop}
        />
      );
  }
}

function cwdOf(agents: RosterAgent[], id: string): string {
  return agents.find((a) => a.id === id)?.projectPath ?? "";
}

const IconBox = ({ children }: { children: React.ReactNode }) => (
  <span className="grid size-[30px] shrink-0 place-items-center rounded-(--r2) border border-line2 text-ink2">
    {children}
  </span>
);

function FileSheet({
  sheet,
  sessionId,
  agent,
}: {
  sheet: Extract<ChatSheet, { kind: "file" }>;
  sessionId: string | null;
  agent: RosterAgent | undefined;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = sheet.path.split("/").pop() ?? sheet.path;
  const markdown = /\.(md|mdx)$/i.test(name);

  useEffect(() => {
    let live = true;
    setText(null);
    setError(null);
    invoke<string>("read_doc", { path: sheet.path })
      .then((body) => live && setText(body))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [sheet.path]);

  const download = async () => {
    if (text === null) return;
    try {
      const path = await save({ defaultPath: name });
      if (path === null) return;
      await invoke("write_text_file", { path, contents: text });
      toast(`Saved ${name}`, { icon: <Check /> });
    } catch (e) {
      toast(`Could not save it: ${String(e)}`);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && closeSheet()}
      width={600}
      title={name}
      sub={`${sheet.path.replace(/^\/Users\/[^/]+/, "~")}${agent ? ` · ${agent.name}` : ""}`}
      icon={<IconBox><FileText className="size-3.5" /></IconBox>}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => void openFile(sheet.path)}>
            <Pencil /> Open in editor
          </Button>
          <Button variant="outline" size="sm" disabled={text === null} onClick={() => void download()}>
            <Download /> Download
          </Button>
          {agent && (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                appendToDraft(sessionId, `About ${name}: `);
                closeSheet();
                focusComposer();
              }}
            >
              Ask {agent.name} about it
            </Button>
          )}
        </>
      }
    >
      {error ? (
        <p className="text-[13px] text-red">{error}</p>
      ) : text === null ? (
        <SkeletonRegion label="Reading">
          <SkeletonText lines={4} />
        </SkeletonRegion>
      ) : markdown ? (
        <div className="text-[14px] leading-[1.75]">
          <Markdown>{text}</Markdown>
        </div>
      ) : (
        <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{text}</pre>
      )}
    </Sheet>
  );
}

/// One line of a unified diff, coloured by what it does.
export function diffClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index "))
    return "bg-s2 text-ink3";
  if (line.startsWith("@@")) return "bg-s2 text-ink3";
  if (line.startsWith("+")) return "bg-green/10 text-green";
  if (line.startsWith("-")) return "bg-red/10 text-red";
  return "text-ink2";
}

const MAX_DIFF_LINES = 3000;

function PrSheet({ sheet, cwd }: { sheet: Extract<ChatSheet, { kind: "pr" }>; cwd: string }) {
  const [pr, setPr] = useState<PrListItem | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    let live = true;
    setPr(null);
    setDiff(null);
    setError(null);
    invoke<PrListItem>("pull_request_by_number", { cwd, number: sheet.number })
      .then((p) => live && setPr(p))
      .catch((e) => live && setError(typeof e === "string" ? e : "GitHub did not answer for this pull request."));
    invoke<string>("pr_diff", { cwd, number: sheet.number })
      .then((d) => live && setDiff(d))
      .catch(() => live && setDiff(""));
    return () => {
      live = false;
    };
  }, [cwd, sheet.number]);

  const approve = async () => {
    setApproving(true);
    try {
      await invoke("submit_review", { cwd, number: sheet.number, verdict: "approve", body: "" });
      setApproved(true);
      toast(`PR #${sheet.number} approved`, { icon: <Check /> });
    } catch (e) {
      toast(`Could not approve: ${String(e)}`);
    } finally {
      setApproving(false);
    }
  };

  const lines = diff ? diff.split("\n") : [];

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && closeSheet()}
      width={640}
      title={pr?.title ?? `PR #${sheet.number}`}
      sub={`GitHub · ${sheet.repo} · ${pr ? pr.state.toLowerCase() : "…"}`}
      icon={<IconBox><GitPullRequest className="size-3.5" /></IconBox>}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => void openUrl(sheet.url)}>
            <ExternalLink /> Open on GitHub
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            disabled={approving || approved || pr?.state === "MERGED" || pr?.state === "CLOSED"}
            onClick={() => void approve()}
          >
            {approved ? "Approved" : approving ? "Approving…" : "Approve PR"}
          </Button>
        </>
      }
    >
      {error && <p className="mb-3 text-[13px] text-red">{error}</p>}
      {pr && (
        <p className="mb-3 text-[13px] text-ink2">
          <code className="font-mono text-[12px]">{pr.headRefName}</code> into{" "}
          <code className="font-mono text-[12px]">{pr.baseRefName}</code> · {pr.changedFiles}{" "}
          {pr.changedFiles === 1 ? "file" : "files"} ·{" "}
          <span className="text-green">+{pr.additions}</span> <span className="text-red">−{pr.deletions}</span>
        </p>
      )}
      {diff === null ? (
        <SkeletonRegion label="Reading the diff">
          <SkeletonText lines={5} />
        </SkeletonRegion>
      ) : lines.length === 0 || diff.trim() === "" ? (
        <p className="text-[13px] text-ink3">No diff to show.</p>
      ) : (
        <div className="overflow-hidden rounded-(--r3) bg-(--code-well) font-mono text-[11.5px] leading-[1.75] shadow-[inset_0_0_0_1px_var(--line)]">
          {lines.slice(0, MAX_DIFF_LINES).map((line, i) => (
            <div key={i} className={cn("px-3.5 whitespace-pre", diffClass(line))}>
              {line || " "}
            </div>
          ))}
          {lines.length > MAX_DIFF_LINES && (
            <div className="bg-s2 px-3.5 text-ink3">… {lines.length - MAX_DIFF_LINES} more lines on GitHub</div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function ExchangeSheet({
  sheet,
  agents,
}: {
  sheet: Extract<ChatSheet, { kind: "exchange" }>;
  agents: RosterAgent[];
}) {
  const byName = (n: string) => agents.find((a) => a.name.toLowerCase() === n.toLowerCase());
  const rows = [
    { who: sheet.from, text: sheet.ask },
    ...(sheet.answer ? [{ who: sheet.to, text: sheet.answer }] : []),
  ];

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && closeSheet()}
      width={520}
      title={`${sheet.from} and ${sheet.to}`}
      sub={sheet.answer ? "2 messages between agents" : "1 message between agents"}
    >
      <div className="flex flex-col gap-5">
        {rows.map((row, i) => {
          const agent = byName(row.who);
          return (
            <div key={i} className="flex gap-3">
              {agent ? (
                <AgentAvatar agent={agent} size={32} />
              ) : (
                <span className="grid size-8 shrink-0 place-items-center rounded-(--r2) bg-s3 text-xs">
                  {row.who.slice(0, 1)}
                </span>
              )}
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">
                  {row.who}
                  <span className="ml-2 text-[11.5px] font-normal text-ink4">
                    {i === 0 ? `to ${sheet.to}` : `to ${sheet.from}`}
                  </span>
                </div>
                <p className="mt-0.5 text-[13.5px] leading-relaxed whitespace-pre-wrap wrap-anywhere text-ink2">
                  {row.text}
                </p>
              </div>
            </div>
          );
        })}
        {!sheet.answer && <p className="text-[12.5px] text-ink3">No answer came back to this one.</p>}
      </div>
    </Sheet>
  );
}

function ApprovalSheet({
  sheet,
  sessionId,
  onRespond,
}: {
  sheet: Extract<ChatSheet, { kind: "approval" }>;
  sessionId: string | null;
  onRespond: (sessionId: string, requestId: string, optionId: string) => void;
}) {
  const ask = sheet.ask;
  const argument = toolArgument(ask.input);
  const [sent, setSent] = useState(false);

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && closeSheet()}
      width={560}
      title={ask.title ?? ask.displayName ?? ask.toolName}
      sub="Waiting for you"
      footer={ask.options.map((option) => (
        <Button
          key={option.id}
          size="sm"
          variant={option.kind === "once" ? "default" : option.behavior === "deny" ? "outline" : "secondary"}
          disabled={sent || !sessionId}
          onClick={() => {
            if (!sessionId) return;
            setSent(true);
            onRespond(sessionId, ask.requestId, option.id);
            closeSheet();
          }}
        >
          {option.label}
        </Button>
      ))}
    >
      <p className="text-[14px] leading-relaxed">{ask.description ?? ask.title ?? ask.toolName}</p>
      {argument && (
        <pre className="mt-3 overflow-x-auto rounded-(--r2) bg-(--code-well) px-3 py-2.5 font-mono text-xs shadow-[inset_0_0_0_1px_var(--line)]">
          {argument}
        </pre>
      )}
      {ask.decisionReason && (
        <p className="mt-3 text-[12.5px] text-ink3">{stripAnsi(ask.decisionReason)}</p>
      )}
      {ask.blockedPath && (
        <p className="mt-2 text-[12.5px] text-ink3">
          Path: <code className="font-mono">{ask.blockedPath}</code>
        </p>
      )}
    </Sheet>
  );
}

/// A shell in the agent's folder. Opened when the reader takes over: it is the
/// reader's own process, separate from the agent's, so the agent keeps working
/// unless it is stopped from here.
function TerminalSheet({
  sheet,
  agent,
  busy,
  onStop,
}: {
  sheet: Extract<ChatSheet, { kind: "terminal" }>;
  agent: RosterAgent | undefined;
  busy: boolean;
  onStop: () => void;
}) {
  const [screen, setScreen] = useState<Screen>(EMPTY_SCREEN);
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    let offData: (() => void) | undefined;
    let offExit: (() => void) | undefined;

    (async () => {
      try {
        // Listening before opening, so the first prompt is not printed to nobody.
        // Each listener is dropped on the spot if the sheet closed while it was
        // being registered, or it would outlive the effect that owns it.
        const data = await listen<{ id: string; data: string }>("pty_data", (e) => {
          if (e.payload.id === idRef.current) setScreen((s) => feed(s, e.payload.data));
        });
        if (!live) return data();
        offData = data;
        const exit = await listen<{ id: string }>("pty_exit", (e) => {
          if (e.payload.id === idRef.current) setExited(true);
        });
        if (!live) return exit();
        offExit = exit;
        const id = await invoke<string>("pty_open", { cwd: sheet.cwd, cols: 100, rows: 30 });
        if (!live) {
          void invoke("pty_close", { id });
          return;
        }
        idRef.current = id;
        setPtyId(id);
      } catch (e) {
        if (live) setError(String(e));
      }
    })();

    return () => {
      live = false;
      offData?.();
      offExit?.();
      if (idRef.current) void invoke("pty_close", { id: idRef.current });
      idRef.current = null;
    };
  }, [sheet.cwd]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [screen]);

  const send = (data: string) => {
    if (ptyId) void invoke("pty_write", { id: ptyId, data }).catch((e) => setError(String(e)));
  };

  const name = agent?.name ?? "the agent";

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && closeSheet()}
      mode="centered"
      width={680}
      title={`A shell in ${name}'s folder`}
      sub={sheet.cwd.replace(/^\/Users\/[^/]+/, "~")}
      footer={
        <>
          {busy && (
            <Button variant="outline" size="sm" onClick={onStop}>
              <Square className="fill-current" /> Stop {name}
            </Button>
          )}
          <span className="text-xs text-ink3">
            {busy ? `${name} keeps working until you stop it.` : "Nothing else is running here."}
          </span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              closeSheet();
              toast(`${name} has the folder back`, { icon: <X /> });
            }}
          >
            Give it back to {name}
          </Button>
        </>
      }
    >
      <div
        ref={scroller}
        onClick={() => document.getElementById("pty-input")?.focus()}
        className="h-[300px] overflow-y-auto rounded-(--r3) bg-(--code-well) px-3.5 py-3 font-mono text-xs leading-[1.7] text-ink2 shadow-[inset_0_0_0_1px_var(--line)]"
      >
        <pre className="whitespace-pre-wrap wrap-anywhere">{screenText(screen)}</pre>
        {error && <p className="text-red">{error}</p>}
        {exited ? (
          <p className="text-ink3">The shell ended.</p>
        ) : (
          <input
            id="pty-input"
            autoFocus
            value={line}
            disabled={!ptyId}
            placeholder={ptyId ? "type a command, Enter to run" : "starting…"}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send(`${line}\n`);
                setLine("");
              } else if (e.ctrlKey && e.key === "c") {
                e.preventDefault();
                send("\u0003");
                setLine("");
              } else if (e.ctrlKey && e.key === "d") {
                e.preventDefault();
                send("\u0004");
              }
            }}
            className="mt-1 w-full bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink4"
          />
        )}
      </div>
    </Sheet>
  );
}
