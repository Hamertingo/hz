import { convertFileSrc } from "@tauri-apps/api/core";
import { AlarmClock, CircleCheck, CircleX, KeyRound, Monitor, QrCode, Sparkles, SquareMousePointer, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import ComputerViewer from "@/components/computer/ComputerViewer";
import { useComputer } from "@/components/computer/useComputer";
import { DraftCard, PageCard, RichCard, StepsBlock, SysRow } from "@/components/chat/cards";
import ImageLightbox from "@/components/chat/ImageLightbox";
import { Card as KitCard } from "@/components/kit/kit";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { appendToDraft } from "@/hooks/useDraft";
import { useAgentChatActions } from "@/hooks/useAgentChat";
import { focusComposer } from "@/lib/composerFocus";
import type { PostCard, Region, ToolPost } from "@/lib/hzTools";
import { kit, type Draft } from "@/lib/kit";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

/// What the agent posted with its hz tools this turn (`lib/hzTools.ts` reads them off the calls), each card wired
/// to the backend state behind it. Outside an agent's chat there is no agent to act for, and nothing is drawn.
export default function AgentPosts({ posts, running }: { posts: ToolPost[]; running: boolean }) {
  const chat = useAgentChatActions();
  if (!chat || posts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {posts.map(({ key, card, stored }) => (
        <Kept key={key} id={stored} fallback={card}>
          {(c) => <Post card={c} agent={chat.agent} sessionId={chat.sessionId} running={running} onOpenProfile={chat.onOpenProfile} />}
        </Kept>
      ))}
    </div>
  );
}

/// The card as the backend kept it, over the one read off the call's input while that loads or when it is gone.
function Kept({ id, fallback, children }: { id?: string; fallback: ToolPost["card"]; children: (card: ToolPost["card"]) => React.ReactNode }) {
  const [kept, setKept] = useState<ToolPost["card"] | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    kit
      .post(id)
      .then((c) => live && setKept(c as ToolPost["card"]))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  // The transcript says how a sign-in ended; a card kept before that answer must not undo it.
  return <>{children(kept ? ({ ...fallback, ...kept, ...("state" in fallback ? { state: fallback.state } : {}) } as ToolPost["card"]) : fallback)}</>;
}

function Post({
  card,
  agent,
  sessionId,
  running,
  onOpenProfile,
}: {
  card: ToolPost["card"];
  agent: RosterAgent;
  sessionId: string | null;
  running: boolean;
  onOpenProfile: (id: string) => void;
}) {
  switch (card.type) {
    case "draft":
      return card.id ? <LiveDraft id={card.id} to={card.to} part={card.part} body={card.body} channel={card.channel} /> : <RichCard card={card} />;
    case "page":
      return card.id ? <LivePage id={card.id} title={card.title} version={card.version} /> : <RichCard card={card} />;
    case "widget":
      return <Widget id={card.id} title={card.title} sessionId={sessionId} />;
    case "image":
      return <Screenshot path={card.path} caption={card.caption} agent={agent} />;
    case "plan":
      return <Plan steps={card.steps} running={running} />;
    case "watch":
      return (
        <SysRow icon={<AlarmClock />}>
          Wakes {agent.name} when {card.label} ends{card.pid ? ` · pid ${card.pid}` : ""}
        </SysRow>
      );
    case "signin":
      return <SignIn card={card} agent={agent} />;
    case "agent":
      return (
        <SysRow icon={<UserPlus />} link={card.id ? "Open" : undefined} onLink={() => onOpenProfile(card.id)}>
          Made a new agent: <b className="font-medium text-ink2">{card.name}</b>
          {card.role ? ` · ${card.role}` : ""}
        </SysRow>
      );
    default:
      return <RichCard card={card} />;
  }
}

/// The chat's card width, as `cards.tsx` draws its own.
function Card(props: React.ComponentProps<typeof KitCard>) {
  return <KitCard {...props} className={cn("w-fit max-w-[min(500px,100%)]", props.className)} />;
}

const sub = "mt-0.5 text-[12.5px] leading-snug text-ink3";

function channelName(channel: string) {
  return channel === "gmail" ? "Gmail" : channel.startsWith("app:") ? channel.slice(4) : "the clipboard";
}

/// A draft card that knows what became of its draft, and sends through the backend.
function LiveDraft({ id, to, part, body, channel = "clipboard" }: { id: string; to: string; part: string; body: string; channel?: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    let live = true;
    kit
      .drafts()
      .then((all) => live && setDraft(all.find((d) => d.id === id) ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);

  const state = draft?.state.state ?? "draft";
  const via = draft?.channel ?? channel;
  const status =
    state === "sent"
      ? via === "clipboard"
        ? `Copied${draft?.receipt ? ` at ${draft.receipt}` : ""} · ready to paste`
        : `Sent with ${channelName(via)}${draft?.receipt ? ` · ${draft.receipt}` : ""}`
      : state === "discarded"
        ? "Discarded"
        : state === "send_requested"
          ? "Sending…"
          : null;

  const send = async (text: string) => {
    try {
      // The clipboard's send is the copy itself, made here where the clipboard is.
      if (via === "clipboard") await navigator.clipboard.writeText(text);
      const next = await kit.draftSend(id, text);
      setDraft(next);
      if (next.state.state === "failed") toast(`Not sent: ${next.state.reason ?? "unknown reason"}`);
    } catch (e) {
      toast(`Could not send it: ${String(e)}`);
    }
  };
  const discard = () =>
    void kit
      .draftAct(id, "discard")
      .then(setDraft)
      .catch((e) => toast(`Could not discard it: ${String(e)}`));

  return (
    <DraftCard
      id={id}
      to={draft?.to ?? to}
      part={draft?.subject ?? part}
      body={draft?.body ?? body}
      key={draft ? "loaded" : "posted"}
      channel={via}
      onSend={send}
      onDiscard={discard}
      status={status}
      problem={state === "failed" ? draft?.state.reason : null}
      attachments={draft?.attachments}
    />
  );
}

/// The page document as a frame shows it: the agent's body under a stylesheet of ours, with no scripts and no network.
function pageDoc(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{font:14px/1.6 -apple-system,system-ui,sans-serif;margin:28px auto;max-width:720px;padding:0 20px;color:#1d1d1f;background:#fff}h1,h2,h3{line-height:1.25}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}img{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${html}</body></html>`;
}

type PageView = { title: string; version: number; current: number; html: string };

/// A live page: a thumbnail of how it reads now, Open page at full size, and its versions.
function LivePage({ id, title, version }: { id: string; title: string; version: number }) {
  const [page, setPage] = useState<PageView | null>(null);
  const [sheet, setSheet] = useState<"page" | "versions" | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    kit
      .pageGet(id)
      .then((p) => live && setPage(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, reload]);

  const thumb = (
    <span className="relative h-[62px] w-[92px] shrink-0 overflow-hidden rounded-lg bg-white shadow-[inset_0_0_0_1px_var(--line2)]">
      {page && (
        <iframe
          title=""
          aria-hidden
          tabIndex={-1}
          sandbox=""
          srcDoc={pageDoc(page.html)}
          className="pointer-events-none absolute top-0 left-0 h-[248px] w-[368px] origin-top-left scale-[0.25] border-0"
        />
      )}
    </span>
  );
  return (
    <>
      <PageCard
        title={page?.title ?? title}
        url={page && page.current > version ? `Live page · now at version ${page.current}` : "Live page"}
        version={version}
        thumb={thumb}
        onOpen={() => setSheet("page")}
        onVersions={() => setSheet("versions")}
      />
      {sheet === "page" && <PageSheet id={id} onClose={() => setSheet(null)} onVersions={() => setSheet("versions")} />}
      {sheet === "versions" && (
        <VersionsSheet
          id={id}
          title={page?.title ?? title}
          onClose={() => {
            setSheet(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function PageSheet({ id, version, onClose, onVersions }: { id: string; version?: number; onClose: () => void; onVersions?: () => void }) {
  const [page, setPage] = useState<PageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    kit.pageGet(id, version).then(setPage, (e) => setError(String(e)));
  }, [id, version]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      width={760}
      title={page?.title ?? "Page"}
      sub={page ? `Version ${page.version}${page.version === page.current ? "" : ` of ${page.current}`}` : undefined}
      footer={
        onVersions && (
          <Button variant="outline" size="sm" onClick={onVersions}>
            Versions
          </Button>
        )
      }
    >
      {error ? (
        <p className="p-4 text-[13px] text-ink3">{error}</p>
      ) : page ? (
        <iframe title={page.title} sandbox="" srcDoc={pageDoc(page.html)} className="h-full min-h-[70vh] w-full rounded-lg border-0 bg-white" />
      ) : null}
    </Sheet>
  );
}

/// Every version of a page, newest first: look at one, or bring it back as a new version.
function VersionsSheet({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const [history, setHistory] = useState<[number, number][] | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const load = () => void kit.pageHistory(id).then(setHistory, () => setHistory([]));
  useEffect(load, [id]);
  const restore = async (n: number) => {
    try {
      const v = await kit.pageRestore(id, n);
      toast(`Version ${n} is back, as version ${v}`);
      load();
    } catch (e) {
      toast(`Could not bring it back: ${String(e)}`);
    }
  };
  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()} width={460} title="Versions" sub={title}>
        <div className="flex flex-col">
          {history?.map(([n, at], i) => (
            <div key={n} className="flex items-center gap-2 border-b border-line py-2.5 text-[13px]">
              <span className="font-medium">Version {n}</span>
              <span className="text-ink3">{new Date(at * 1000).toLocaleString()}</span>
              {i === 0 && <span className="text-xs text-ink4">current</span>}
              <span className="ml-auto flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setViewing(n)}>
                  View
                </Button>
                {i > 0 && (
                  <Button variant="outline" size="sm" onClick={() => void restore(n)}>
                    Bring back
                  </Button>
                )}
              </span>
            </div>
          ))}
          {history?.length === 0 && <p className="py-6 text-center text-[13px] text-ink3">No versions yet.</p>}
        </div>
      </Sheet>
      {viewing !== null && <PageSheet id={id} version={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/// A small page the agent made, run in a frame with no network and no reach into the app. Its `hz.reply(text)`
/// puts words in the composer for the person to send, rather than sending as them.
function Widget({ id, title, sessionId }: { id: string; title: string; sessionId: string | null }) {
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    kit.widgetGet(id).then(setDoc, (e) => setError(String(e)));
  }, [id]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { type?: string; text?: unknown };
      if (data?.type !== "hz-reply" || typeof data.text !== "string" || !data.text.trim()) return;
      appendToDraft(sessionId, data.text.slice(0, 2000));
      focusComposer();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sessionId]);
  return (
    <Card icon={<SquareMousePointer />} label={title || "Widget"} className="w-[min(500px,100%)]">
      {error ? (
        <p className={sub}>This widget is gone: {error}</p>
      ) : doc ? (
        // `allow-scripts` without `allow-same-origin`: its own origin is opaque, and the CSP inside stops the network.
        <iframe ref={frame} title={title} sandbox="allow-scripts" srcDoc={doc} className="h-[280px] w-full rounded-lg border-0 bg-white" />
      ) : (
        <div className="h-[280px] w-full animate-pulse rounded-lg bg-s2" />
      )}
    </Card>
  );
}

/// A picture of the agent's screen, in the chat; pressing it opens it full size.
function Screenshot({ path, caption, agent }: { path: string; caption: string; agent: RosterAgent }) {
  const [open, setOpen] = useState<number | null>(null);
  const src = path.startsWith("data:") ? path : convertFileSrc(path);
  return (
    <figure className="my-0.5 w-[min(420px,100%)]">
      <button type="button" onClick={() => setOpen(0)} className="block w-full cursor-zoom-in overflow-hidden rounded-[13px] shadow-[inset_0_0_0_1px_var(--line2)]">
        <img src={src} alt={caption || `${agent.name}'s screen`} className="block w-full" />
      </button>
      <figcaption className="mt-1 flex items-center gap-1.5 px-0.5 text-[12px] text-ink3 [&>svg]:size-3.5">
        <Monitor />
        {caption || `${agent.name}'s screen`}
      </figcaption>
      <ImageLightbox images={[{ src, name: caption || "Screenshot" }]} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </figure>
  );
}

function Plan({ steps, running }: { steps: { text: string; state: "done" | "run" | "todo" }[]; running: boolean }) {
  const done = steps.every((s) => s.state === "done");
  return (
    <StepsBlock
      heading="Plan"
      defaultOpen
      phase={running ? "working" : done ? "finished" : "stopped"}
      items={steps.map((s, i) => ({ key: String(i), label: s.text, state: running || s.state !== "run" ? s.state : "todo" }))}
    />
  );
}

const QR_EVERY_MS = 4000;

/// The agent's screen, cut down to the code it named, taken again every few seconds since sites rotate their codes.
function LiveCode({ agentId, region }: { agentId: string; region: Region | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    let timer = 0;
    const tick = () =>
      kit
        .screenshot(agentId)
        .then(
          (shot) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                const c = canvas.current;
                if (live && c) {
                  const r = region ?? { x: 0, y: 0, w: img.width, h: img.height };
                  c.width = r.w;
                  c.height = r.h;
                  c.getContext("2d")?.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
                  setShown(true);
                }
                resolve();
              };
              img.onerror = () => resolve();
              img.src = shot;
            }),
        )
        .catch(() => {})
        .finally(() => {
          if (live) timer = window.setTimeout(tick, QR_EVERY_MS);
        });
    void tick();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [agentId, region]);
  return (
    <div className="grid size-[132px] shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1.5">
      <canvas ref={canvas} className={cn("max-h-full max-w-full", !shown && "hidden")} />
      {!shown && <QrCode className="size-8 animate-pulse text-neutral-400" />}
    </div>
  );
}

/// A sign-in the person does on the agent's computer: they open its screen, type into the page themselves and say
/// when they are done. The agent waits on the answer and never sees what was typed.
function SignIn({ card: logged, agent }: { card: Extract<PostCard, { type: "signin" }>; agent: RosterAgent }) {
  const [viewing, setViewing] = useState(false);
  // While it waits there is no answer to name a kept card, so the backend's waiting card stands in for the input.
  const [pending, setPending] = useState<Partial<typeof logged> | null>(null);
  useEffect(() => {
    if (logged.state !== "waiting") return;
    kit.loginPending(agent.id).then((c) => setPending(c as Partial<typeof logged> | null), () => {});
  }, [agent.id, logged.state]);
  const card = { ...logged, ...(pending ?? {}), state: logged.state };
  const [answered, setAnswered] = useState(false);
  const computer = useComputer(agent.id, viewing);

  if (card.state !== "waiting") {
    const word = card.state === "done" ? "Signed in to" : card.state === "declined" ? "Skipped signing in to" : "No answer to the sign-in for";
    return (
      <SysRow icon={card.state === "done" ? <CircleCheck /> : <CircleX />}>
        {word} <b className="font-medium text-ink2">{card.site}</b>
      </SysRow>
    );
  }
  const answer = (done: boolean) => {
    setAnswered(true);
    void kit.loginAnswer(agent.id, done).catch((e) => {
      setAnswered(false);
      toast(String(e));
    });
    if (computer.control) void computer.drive(false);
  };
  return (
    <>
      <Card
        icon={card.qr ? <QrCode /> : <KeyRound />}
        label={card.qr ? "Scan to sign in" : `Sign in on ${agent.name}'s computer`}
        foot={
          <>
            <Button variant="solid" size="sm" disabled={answered} onClick={() => answer(true)}>
              {card.qr ? "Scanned it" : "I'm signed in"}
            </Button>
            {!card.qr && (
              <Button variant="outline" size="sm" onClick={() => setViewing(true)}>
                <Monitor /> Open its screen
              </Button>
            )}
            <Button variant="ghost" size="sm" className="ml-auto text-ink3" disabled={answered} onClick={() => answer(false)}>
              Not now
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-3.5">
          {card.qr && <LiveCode agentId={agent.id} region={card.region} />}
          <div className="min-w-0">
            <p className="text-[13.5px] leading-snug font-medium">{card.site}</p>
            <p className={sub}>{card.why}</p>
            <p className={cn(sub, "mt-1.5 flex items-center gap-1 [&>svg]:size-3")}>
              <Sparkles />
              {card.qr ? `Scan it with your phone. ${agent.name} waits.` : `You type into the page yourself; ${agent.name} never sees the password.`}
            </p>
          </div>
        </div>
      </Card>
      <ComputerViewer agent={agent} open={viewing} onOpenChange={setViewing} computer={computer} onSize={() => toast("The size is set in the agent's Computer tab")} />
    </>
  );
}
