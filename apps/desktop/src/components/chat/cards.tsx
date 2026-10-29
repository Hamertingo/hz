import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Code,
  Copy,
  FileText,
  Globe,
  Hand,
  History,
  KeyRound,
  MessageCircleQuestion,
  Pause,
  PenLine,
  Phone,
  Play,
  QrCode,
  Shield,
  ChartColumn,
  Square,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type ReactNode } from "react";

import Dither from "@/components/Dither";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Card as KitCard, Choice } from "@/components/kit/kit";
import { kit } from "@/lib/kit";
import { cn } from "@/lib/utils";

/// The rich cards an agent posts, in the shared `Card` frame. The app has events for some (a permission
/// request, a question, a plan, a file, a pull request) and none yet for the rest; every card here takes
/// plain typed data, so a producer can be wired to it without touching the look. Nothing renders on its
/// own: a caller passes a `RichCardData` and the handlers it has, and a handler left off hides its button.

export type RichCardData =
  | { type: "question"; who: string; title: string; detail?: string; options: string[]; recommended?: number; time?: string }
  | { type: "approval"; who: string; title: string; detail?: string; command?: string; time?: string; always?: boolean }
  | { type: "chart"; title: string; unit?: string; bars: [label: string, value: number][]; highlight?: number; note?: string; kind?: "bar" | "line" | "pie" }
  | { type: "sources"; items: { domain: string; title: string; href?: string }[] }
  | { type: "page"; id?: string; title: string; url: string; version: number }
  | { type: "draft"; id?: string; to: string; part: string; body: string; channel?: string }
  | { type: "code"; file: string; code: string }
  | { type: "voice"; duration: string; peaks?: number[] }
  | { type: "gen"; label?: string; color?: string }
  | { type: "key"; name: string; why: string }
  | { type: "takeover"; site: string; why: string }
  | { type: "connect"; app: string; title: string; url: string }
  | { type: "qr"; site: string; why: string; image?: ReactNode }
  | { type: "call"; who: string; duration: string; summary: string[] }
  | { type: "approved"; what: string; command?: string; time?: string; denied?: boolean }
  | { type: "message"; text: string; time?: string; failed?: boolean };

/// What a card can do. A card draws a button only for the handler it was given.
export type RichCardHandlers = {
  onChoose?: (option: string, index: number) => void;
  onApprove?: () => void;
  onDeny?: () => void;
  onAlwaysAllow?: () => void;
  onOpenPage?: () => void;
  onVersions?: () => void;
  onOpenSource?: (domain: string) => void;
  onPlay?: () => void;
  onSaveKey?: (value: string) => void;
  onTakeOver?: () => void;
  onDismiss?: () => void;
};

/// Picks the card for a payload.
export function RichCard({ card, ...on }: { card: RichCardData } & RichCardHandlers) {
  switch (card.type) {
    case "question":
      return <QuestionCard {...card} onChoose={on.onChoose} />;
    case "approval":
      return <ApprovalCard {...card} onApprove={on.onApprove} onDeny={on.onDeny} onAlwaysAllow={on.onAlwaysAllow} />;
    case "chart":
      return <ChartCard {...card} />;
    case "sources":
      return <SourcesCard items={card.items} onOpen={on.onOpenSource} />;
    case "page":
      return <PageCard {...card} onOpen={on.onOpenPage} onVersions={on.onVersions} />;
    case "draft":
      return <DraftCard {...card} />;
    case "code":
      return <CodeCard {...card} />;
    case "voice":
      return <VoiceCard {...card} onPlay={on.onPlay} />;
    case "gen":
      return <GenCard label={card.label} color={card.color} />;
    case "key":
      return <KeyCard {...card} onSave={on.onSaveKey} onDismiss={on.onDismiss} />;
    case "takeover":
      return <TakeoverCard {...card} onTakeOver={on.onTakeOver} onDismiss={on.onDismiss} />;
    case "connect":
      return <ConnectCard {...card} />;
    case "qr":
      return <QrCard {...card} />;
    case "call":
      return <CallRow who={card.who} duration={card.duration} summary={card.summary} />;
    case "approved":
      return <ApprovedRow what={card.what} command={card.command} time={card.time} denied={card.denied} />;
    case "message":
      return <SentMessage {...card} onRetry={on.onDismiss} />;
  }
}

/// The kit card at the width the chat wants: as wide as what it holds, up to 500px.
function Card(props: React.ComponentProps<typeof KitCard>) {
  return <KitCard {...props} className={cn("w-fit max-w-[min(500px,100%)]", props.className)} />;
}

const title = "text-[13.5px] font-medium leading-snug";
const sub = "mt-0.5 text-[12.5px] leading-snug text-ink3";

/// A question with a few answers; the first can carry a "recommended" note.
export function QuestionCard({
  who,
  title: q,
  detail,
  options,
  recommended = 0,
  time,
  onChoose,
}: {
  who: string;
  title: string;
  detail?: string;
  options: string[];
  recommended?: number;
  time?: string;
  onChoose?: (option: string, index: number) => void;
}) {
  return (
    <Card icon={<MessageCircleQuestion />} label={`${who} asks`} right={time}>
      <p className={title}>{q}</p>
      {detail && <p className={sub}>{detail}</p>}
      <div className="mt-2.5 flex flex-col gap-1">
        {options.map((o, i) => (
          <Choice key={o} n={i + 1} note={i === recommended ? "recommended" : undefined} onClick={() => onChoose?.(o, i)}>
            {o}
          </Choice>
        ))}
      </div>
    </Card>
  );
}

/// The exact command an agent wants to run, and the three ways to answer.
export function ApprovalCard({
  who,
  title: q,
  detail,
  command,
  time,
  always,
  onApprove,
  onDeny,
  onAlwaysAllow,
  disabled,
  extra,
}: {
  who: string;
  title: string;
  detail?: string;
  command?: string;
  time?: string;
  /// Whether to offer "Always allow this" even without a handler to call.
  always?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  onAlwaysAllow?: () => void;
  disabled?: boolean;
  /// Further buttons the agent offered, drawn after Deny.
  extra?: ReactNode;
}) {
  return (
    <Card
      icon={<Shield />}
      label={`${who} needs your OK`}
      right={time}
      foot={
        <>
          {onApprove && (
            <Button variant="solid" size="sm" disabled={disabled} onClick={onApprove}>
              Approve
            </Button>
          )}
          {onDeny && (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={onDeny}>
              Deny
            </Button>
          )}
          {extra}
          {(onAlwaysAllow || always) && (
            <span className="ml-auto">
              <Button variant="ghost" size="sm" disabled={disabled || !onAlwaysAllow} onClick={onAlwaysAllow} className="text-ink3">
                Always allow this
              </Button>
            </span>
          )}
        </>
      }
    >
      <p className={title}>{q}</p>
      {detail && <p className={sub}>{detail}</p>}
      {command && <Mono className="mt-2" prompt>{command}</Mono>}
    </Card>
  );
}

/// A block of monospace on a faint well; `prompt` puts a dim `$ ` in front.
export function Mono({ children, prompt, className }: { children: ReactNode; prompt?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-[9px] bg-ink/[0.04] px-2.5 py-2 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap text-ink2", className)}>
      {prompt && <span className="text-ink4">$ </span>}
      {children}
    </div>
  );
}

/// Bars with their values on top and labels under; one can be picked out.
export function ChartCard({ title: name, unit = "", bars, highlight, note, kind = "bar" }: { title: string; unit?: string; bars: [string, number][]; highlight?: number; note?: string; kind?: "bar" | "line" | "pie" }) {
  const max = Math.max(1, ...bars.map(([, v]) => v));
  if (kind !== "bar") {
    return (
      <Card icon={<ChartColumn />} label={name}>
        {kind === "line" ? <LineChart unit={unit} points={bars} max={max} /> : <PieChart unit={unit} slices={bars} />}
        {note && <p className={cn(sub, "mt-2")}>{note}</p>}
      </Card>
    );
  }
  return (
    <Card icon={<ChartColumn />} label={name}>
      <div className="flex h-[120px] items-end gap-2.5 border-b border-line px-1 pt-2.5">
        {bars.map(([label, v], i) => (
          <div key={label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[11px] text-ink3">
              {v}
              {unit}
            </span>
            <i
              className={cn("chat-bar w-full max-w-[38px] rounded-t-[5px] rounded-b-[2px] bg-ink/[0.12]", i === highlight && "bg-(--acc,var(--ink))")}
              style={{ height: `${(v / max) * 88}px`, animationDelay: `${i * 50}ms` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-2.5 px-1 pt-1.5 text-[11.5px] text-ink3">
        {bars.map(([label]) => (
          <span key={label} className="flex-1 text-center">
            {label}
          </span>
        ))}
      </div>
      {note && <p className={cn(sub, "mt-2")}>{note}</p>}
    </Card>
  );
}

/// A line over evenly spaced points, each with its value; the labels under, first and last when there are many.
function LineChart({ unit, points, max }: { unit: string; points: [string, number][]; max: number }) {
  const w = 440;
  const h = 110;
  const min = Math.min(0, ...points.map(([, v]) => v));
  const x = (i: number) => (points.length < 2 ? w / 2 : 12 + (i * (w - 24)) / (points.length - 1));
  const y = (v: number) => 12 + (1 - (v - min) / (max - min || 1)) * (h - 24);
  const path = points.map(([, v], i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const few = points.length <= 8;
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[120px] w-[min(440px,100%)] overflow-visible text-(--acc,var(--ink))" aria-hidden>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map(([label, v], i) => (
          <g key={label + i}>
            <circle cx={x(i)} cy={y(v)} r="3" fill="currentColor" />
            {few && (
              <text x={x(i)} y={y(v) - 7} textAnchor="middle" className="fill-ink3 text-[11px]">
                {v}
                {unit}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex justify-between gap-2 border-t border-line px-1 pt-1.5 text-[11.5px] text-ink3">
        {(few ? points : [points[0], points[points.length - 1]]).map(([label], i) => (
          <span key={label + i}>{label}</span>
        ))}
      </div>
    </>
  );
}

/// A ring of shares, with each slice's label and part of the whole beside it.
function PieChart({ unit, slices }: { unit: string; slices: [string, number][] }) {
  const total = slices.reduce((t, [, v]) => t + Math.max(0, v), 0) || 1;
  let at = 0;
  const stops = slices.map(([, v], i) => {
    const from = at;
    at += (Math.max(0, v) / total) * 100;
    return `color-mix(in srgb, var(--acc, var(--ink)) ${100 - ((i * 55) / Math.max(1, slices.length - 1))}%, var(--s2)) ${from}% ${at}%`;
  });
  return (
    <div className="flex items-center gap-4">
      <span className="size-[96px] shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(", ")})`, mask: "radial-gradient(circle, transparent 52%, #000 53%)" }} />
      <ul className="min-w-0 text-[12.5px] leading-[1.7]">
        {slices.map(([label, v]) => (
          <li key={label} className="flex gap-2">
            <span className="truncate">{label}</span>
            <span className="ml-auto text-ink3 tabular-nums">
              {v}
              {unit}
              {unit !== "%" && ` · ${Math.round((Math.max(0, v) / total) * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/// The pages an answer drew on, as small hairline pills.
export function SourcesCard({ items, onOpen }: { items: { domain: string; title: string; href?: string }[]; onOpen?: (domain: string) => void }) {
  return (
    <Card icon={<Globe />} label={`${items.length} ${items.length === 1 ? "source" : "sources"}`}>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <button
            key={s.domain}
            type="button"
            title={s.title}
            onClick={() => onOpen?.(s.domain)}
            className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full pr-[9px] pl-1 text-xs text-ink2 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s2 hover:text-ink"
          >
            <i className="grid size-4 place-items-center rounded-full bg-s3 text-[9px] font-semibold text-ink2 not-italic">{s.domain[0]?.toUpperCase()}</i>
            {s.domain}
          </button>
        ))}
      </div>
    </Card>
  );
}

/// A page the agent built: a thumbnail, where it lives, and the way in.
export function PageCard({ title: name, url, version, onOpen, onVersions, thumb }: { title: string; url: string; version: number; onOpen?: () => void; onVersions?: () => void; thumb?: ReactNode }) {
  return (
    <Card
      icon={<FileText />}
      label={`Page · version ${version}`}
      foot={
        <>
          {onOpen && (
            <Button variant="solid" size="sm" onClick={onOpen}>
              Open page
            </Button>
          )}
          {onVersions && (
            <Button variant="ghost" size="sm" onClick={onVersions}>
              <History /> Versions
            </Button>
          )}
        </>
      }
    >
      <div className="flex items-center gap-3">
        {thumb ?? (
          <span className="flex h-[62px] w-[92px] shrink-0 flex-col gap-1 rounded-lg bg-s2 p-[7px] shadow-[inset_0_0_0_1px_var(--line2)]">
            <i className="block h-[7px] w-3/5 rounded-[2px] bg-[color-mix(in_srgb,var(--acc,var(--ink))_60%,rgba(255,255,255,.12))]" />
            <i className="block h-[5px] rounded-[2px] bg-ink/15" />
            <i className="block h-[5px] w-4/5 rounded-[2px] bg-ink/15" />
            <i className="block h-[5px] rounded-[2px] bg-ink/15" />
          </span>
        )}
        <div className="min-w-0">
          <b className="block truncate text-[13.5px] font-medium">{name}</b>
          <span className="block truncate text-xs text-ink3">{url}</span>
        </div>
      </div>
    </Card>
  );
}

/// Where a draft goes, as its Send button says it.
function sendLabel(channel: string): string {
  if (channel === "gmail") return "Send with Gmail";
  if (channel.startsWith("app:")) return `Send with ${channel.slice(4)}`;
  return "Copy to send";
}

/// A message the agent drafted for someone else. With a stored draft (`id`) Edit saves through the
/// backend; without one the edit stays on the card. Send and Discard show only with their handlers;
/// `status` settles the card (sent, discarded) and leaves only Copy.
export function DraftCard({
  id,
  to,
  part,
  body,
  channel = "clipboard",
  onSend,
  onDiscard,
  status,
  problem,
  attachments = [],
}: {
  id?: string;
  to: string;
  part: string;
  body: string;
  channel?: string;
  onSend?: (text: string) => Promise<void> | void;
  onDiscard?: () => void;
  status?: string | null;
  /// Why the last send failed; the card stays a draft under it.
  problem?: string | null;
  attachments?: string[];
}) {
  const [text, setText] = useState(body);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (id) {
      setSaving(true);
      try {
        await kit.draftAct(id, "edit", text);
      } catch (e) {
        toast(`Could not save the draft: ${String(e)}`);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    setEditing(false);
  };

  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => toast("Copied", { ms: 1400 }),
      () => toast("Could not copy"),
    );

  return (
    <Card
      icon={<PenLine />}
      label="Draft"
      foot={
        editing ? (
          <>
            <Button variant="solid" size="sm" disabled={saving} onClick={() => void save()}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText(body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : status ? (
          <>
            <span className="text-[12.5px] text-ink3">{status}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={copy}>
              <Copy /> Copy
            </Button>
          </>
        ) : (
          <>
            {onSend && (
              <Button
                variant="solid"
                size="sm"
                disabled={sending}
                onClick={() => {
                  setSending(true);
                  void Promise.resolve(onSend(text)).finally(() => setSending(false));
                }}
              >
                {sendLabel(channel)}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <PenLine /> Edit
            </Button>
            {!(onSend && channel === "clipboard") && (
              <Button variant="ghost" size="sm" onClick={copy}>
                <Copy /> Copy
              </Button>
            )}
            {onDiscard && (
              <Button variant="ghost" size="sm" className="ml-auto text-ink3" onClick={onDiscard}>
                Discard
              </Button>
            )}
          </>
        )
      }
    >
      <div className="rounded-[9px] bg-ink/[0.03] px-3 py-2.5 text-[13px] leading-[1.55]">
        <div className="mb-2 grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5 border-b border-line pb-2 text-xs text-ink3">
          <span>To</span>
          <b className="font-normal text-ink2">{to}</b>
          {part && (
            <>
              <span>{channel === "gmail" ? "Subject" : "Part"}</span>
              <b className="font-normal text-ink2">{part}</b>
            </>
          )}
          {attachments.length > 0 && (
            <>
              <span>Files</span>
              <b className="truncate font-normal text-ink2">{attachments.map((a) => a.split("/").pop()).join(", ")}</b>
            </>
          )}
        </div>
        {editing ? (
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
            className="block w-full resize-none bg-transparent outline-none"
          />
        ) : (
          <p className="whitespace-pre-wrap">{text}</p>
        )}
      </div>
      {problem && !status && <p className="mt-2 text-[12px] leading-snug text-red">{problem}</p>}
    </Card>
  );
}

/// A snippet with the file it belongs to.
export function CodeCard({ file, code }: { file: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card
      icon={<Code />}
      label={file}
      right={
        <button
          type="button"
          aria-label="Copy"
          onClick={() =>
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            })
          }
          className="grid size-6 cursor-pointer place-items-center rounded-md text-ink3 transition-colors hover:bg-hover hover:text-ink"
        >
          {copied ? <Check /> : <Copy />}
        </button>
      }
    >
      <Mono>{code}</Mono>
    </Card>
  );
}

const PEAKS = Array.from({ length: 34 }, (_, i) => 4 + Math.abs(Math.sin(i * 1.7)) * 16);

/// A voice memo: play, the waveform, the length. Not a Card: it is a message of its own.
export function VoiceCard({ duration, peaks = PEAKS, onPlay }: { duration: string; peaks?: number[]; onPlay?: () => void }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="flex w-[min(300px,100%)] items-center gap-2.5 rounded-full bg-s2 py-2 pr-3.5 pl-2">
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          setPlaying((p) => !p);
          onPlay?.();
        }}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-background transition-opacity hover:opacity-90 [&_svg]:size-3"
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <span className="flex h-[22px] flex-1 items-center gap-0.5">
        {peaks.map((h, i) => (
          <i key={i} className="w-0.5 rounded-sm bg-ink3" style={{ height: h }} />
        ))}
      </span>
      <span className="text-[11.5px] tabular-nums text-ink3">{duration}</span>
    </div>
  );
}

/// An image on its way: a quiet well with a spinner and one line.
export function GenCard({ label = "Drawing the image…", color = "#38bdf8" }: { label?: string; color?: string }) {
  return (
    <div className="relative h-40 w-60 overflow-hidden rounded-[13px] bg-s2">
      <Dither color={color} seed={`gen:${color}`} cols={40} rows={27} className="opacity-55 blur-[6px]" />
      <span className="absolute bottom-[9px] left-2.5 flex items-center gap-1.5 text-xs text-white [text-shadow:0_1px_4px_rgba(0,0,0,.4)]">
        <i className="size-2.5 animate-spin rounded-full border-[1.5px] border-white border-t-transparent" />
        {label}
      </span>
    </div>
  );
}

/// The agent needs a key. It is pasted here, handed to the keychain by the caller, and never shown again.
export function KeyCard({ name, why, onSave, onDismiss }: { name: string; why: string; onSave?: (value: string) => void; onDismiss?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <Card
      icon={<KeyRound />}
      label="Needs a key"
      foot={
        <>
          <Button variant="solid" size="sm" disabled={!value.trim() || !onSave} onClick={() => onSave?.(value.trim())}>
            Save key
          </Button>
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Not now
            </Button>
          )}
        </>
      }
    >
      <p className={title}>{name}</p>
      <p className={sub}>{why} It goes to the keychain; the agent only ever sees {`{{${name}}}`}.</p>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste the key"
        className="mt-2.5 h-8 w-full rounded-lg bg-s1 px-2.5 font-mono text-xs shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:text-ink4 focus:shadow-[inset_0_0_0_1px_var(--line3)]"
      />
    </Card>
  );
}

/// The agent hit something only a person can do in the browser.
export function TakeoverCard({ site, why, onTakeOver, onDismiss }: { site: string; why: string; onTakeOver?: () => void; onDismiss?: () => void }) {
  return (
    <Card
      icon={<Hand />}
      label="Your turn in the browser"
      foot={
        <>
          {onTakeOver && (
            <Button variant="solid" size="sm" onClick={onTakeOver}>
              <Hand /> Take over
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Not now
            </Button>
          )}
        </>
      }
    >
      <p className={title}>{site}</p>
      <p className={sub}>{why}</p>
    </Card>
  );
}

/// An app the agent wants to use through Composio: the button opens its sign-in in the browser, and the
/// agent's `wait_for_app` notices when it is done. Only https links open (`composio_link.rs` refuses others).
export function ConnectCard({ title: name, url }: { app: string; title: string; url: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <Card
      icon={<Globe />}
      label="Connect an app"
      foot={
        <Button
          variant={opened ? "outline" : "solid"}
          size="sm"
          disabled={!url.startsWith("https://")}
          onClick={() => void openUrl(url).then(() => setOpened(true), (e) => toast(String(e)))}
        >
          {opened ? "Open again" : name}
        </Button>
      }
    >
      <p className={title}>{name}</p>
      <p className={sub}>{opened ? "Finish in your browser. The agent carries on once it is connected." : "Opens in your browser. Nothing is shared until you approve it there."}</p>
    </Card>
  );
}

/// A sign-in the reader finishes by scanning a code.
/// A stand-in code: three finder squares and noise from the site's name. The real image arrives through `image`.
function QrPattern({ seed }: { seed: string }) {
  const n = 21;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  const finder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  const cells: ReactNode[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      let on: boolean;
      if (finder(x, y)) {
        const fx = x >= n - 8 ? x - (n - 8) : x;
        const fy = y >= n - 8 ? y - (n - 8) : y;
        const ring = Math.max(Math.abs(fx - 3.5), Math.abs(fy - 3.5));
        on = ring <= 3 && (ring > 2 || ring <= 1);
      } else {
        h = (h * 1103515245 + 12345) | 0;
        on = ((h >>> 16) & 3) > 0 && (h >>> 20) % 2 === 0;
      }
      if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" />);
    }
  }
  return (
    <svg viewBox={`0 0 ${n} ${n}`} fill="currentColor" aria-hidden>
      {cells}
    </svg>
  );
}

export function QrCard({ site, why, image }: { site: string; why: string; image?: ReactNode }) {
  return (
    <Card icon={<QrCode />} label="Scan to sign in">
      <div className="flex items-center gap-3.5">
        <div className="grid size-[84px] shrink-0 place-items-center rounded-lg bg-white p-1.5 text-neutral-900 [&_svg]:size-full">{image ?? <QrPattern seed={site} />}</div>
        <div className="min-w-0">
          <p className={title}>{site}</p>
          <p className={sub}>{why}</p>
        </div>
      </div>
    </Card>
  );
}

/// One of the reader's own messages, drawn on its own, with the failed state under it when the send did not go.
export function SentMessage({ text, time, failed, onRetry }: { text: string; time?: string; failed?: boolean; onRetry?: () => void }) {
  return (
    <div className="mt-2 flex w-full flex-col items-end">
      <div
        className="max-w-[min(560px,100%)] rounded-2xl px-[13px] pt-2 pb-1.5 text-[13.5px] leading-[1.6]"
        style={{ background: "color-mix(in srgb, var(--acc, var(--ink)) 22%, var(--background))" }}
      >
        {text}
        {time && <time className="mt-px block text-right text-[10.5px] tabular-nums text-ink/45">{time}</time>}
      </div>
      {failed && <SendState onRetry={onRetry} />}
    </div>
  );
}

/// "Didn't send · Try again" under a message.
export function SendState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 px-1 text-[11.5px] text-red">
      <CircleX className="size-[13px]" />
      Didn't send
      {onRetry && (
        <>
          <span className="text-ink4">·</span>
          <button type="button" onClick={onRetry} className="cursor-pointer font-medium text-ink underline underline-offset-2">
            Try again
          </button>
        </>
      )}
    </div>
  );
}

/// A line of quiet narration between messages, with an icon and an optional link.
export function SysRow({ icon, children, link, onLink }: { icon: ReactNode; children: ReactNode; link?: string; onLink?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-[7px] px-0.5 py-[5px] text-[12.5px] text-ink3 [&>svg]:size-3.5 [&>svg]:text-ink4">
      {icon}
      <span>{children}</span>
      {link && (
        <button type="button" onClick={onLink} className="-ml-0.5 cursor-pointer rounded-md px-1.5 py-px text-ink2 transition-colors hover:bg-hover hover:text-ink">
          {link}
        </button>
      )}
    </div>
  );
}

/// "Terminal command · approved · Show the card". Open, it is the card with the command.
export function ApprovedRow({ what, command, time, denied }: { what: string; command?: string; time?: string; denied?: boolean }) {
  const [open, setOpen] = useState(false);
  const word = denied ? "denied" : "approved";
  if (open && command) {
    return (
      <Card
        icon={denied ? <CircleX /> : <CircleCheck />}
        label={`${what} · ${word}`}
        right={
          <>
            {time}
            <button type="button" aria-label="Hide the card" onClick={() => setOpen(false)} className="grid size-6 cursor-pointer place-items-center rounded-md hover:bg-hover hover:text-ink">
              <ChevronUp />
            </button>
          </>
        }
      >
        <Mono prompt>{command}</Mono>
      </Card>
    );
  }
  return (
    <SysRow icon={denied ? <CircleX /> : <CircleCheck />} link={command ? "Show the card" : undefined} onLink={() => setOpen(true)}>
      {what} · <b className="font-medium text-ink2">{word}</b>
    </SysRow>
  );
}

/// A finished call: one line, and the summary one press away.
export function CallRow({ who, duration, summary }: { who: string; duration: string; summary: string[] }) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <Card
        icon={<Phone />}
        label={`Call with ${who} · ${duration}`}
        right={
          <button type="button" aria-label="Hide the summary" onClick={() => setOpen(false)} className="grid size-6 cursor-pointer place-items-center rounded-md hover:bg-hover hover:text-ink">
            <ChevronUp />
          </button>
        }
      >
        <ul className="list-disc pl-4 text-[13px] leading-[1.7]">
          {summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Card>
    );
  }
  return (
    <SysRow icon={<Phone />} link="Show the summary" onLink={() => setOpen(true)}>
      Call with {who} · {duration}
    </SysRow>
  );
}

/// How a step stands. Done steps are struck through; the running one spins.
export type StepState = "done" | "run" | "todo";
export type StepItem = { key: string; label: ReactNode; state: StepState; right?: ReactNode };

/// One step with its circle: dashed while waiting, a ring that turns while it runs, filled green with a tick when done.
export function Step({ state, children, right }: { state: StepState; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2.5 py-1 text-[13px] leading-[1.45]", state === "done" && "text-ink3")}>
      <span
        className={cn(
          "mt-px grid size-[17px] shrink-0 place-items-center rounded-full",
          state === "done" && "bg-green text-white",
          state === "run" && "animate-spin border-[1.5px] border-blue border-t-transparent",
          state === "todo" && "border-[1.25px] border-dashed border-ink4",
        )}
      >
        {state === "done" && <Check className="size-2.5" strokeWidth={3} />}
      </span>
      <span className={cn("min-w-0 flex-1", state === "done" && "line-through decoration-ink4")}>{children}</span>
      {right && <span className="shrink-0 text-[11px] tabular-nums text-ink4 no-underline">{right}</span>}
    </div>
  );
}

/// The steps of a piece of work: a pill that says where it stands, and the card it opens onto.
/// `phase` is Working while it runs, Finished once every step is done, Stopped at if it ended short.
export function StepsBlock({
  heading,
  items,
  phase,
  summary,
  time,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  onStop,
  onResume,
  children,
}: {
  heading?: ReactNode;
  items: StepItem[];
  phase?: "working" | "stopped" | "finished";
  /// Replaces "Working 2 of 5 steps" in the pill, for work that has no fixed list.
  summary?: string;
  time?: string | null;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onStop?: () => void;
  onResume?: () => void;
  children?: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const set = (v: boolean) => {
    setOwn(v);
    onOpenChange?.(v);
  };
  const done = items.filter((i) => i.state === "done").length;
  const all = done === items.length;
  const kind = phase ?? (all ? "finished" : "stopped");
  const state = kind === "working" ? "Working" : kind === "finished" ? "Finished" : "Stopped at";
  const count = kind === "finished" ? `${items.length} ${items.length === 1 ? "step" : "steps"}` : `${done} of ${items.length} steps`;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => set(true)}
        data-steps-pill=""
        className="chat-pop my-[3px] inline-flex h-[30px] w-max cursor-pointer items-center gap-2 rounded-full pr-2.5 pl-1.5 text-[12.5px] font-medium shadow-[inset_0_0_0_1px_var(--line2)] transition-colors hover:bg-s2"
      >
        <span className={cn("grid size-5 place-items-center rounded-full bg-s3 [&_svg]:size-2.5", kind === "working" && "text-blue")}>
          {kind === "working" ? <Play /> : kind === "finished" ? <Check /> : <Pause />}
        </span>
        {summary ?? `${state} ${count}`}
        {time && <i className="font-normal text-ink3 not-italic">{time}</i>}
        <ChevronDown className="size-3.5 text-ink4" />
      </button>
    );
  }

  return (
    <div className="chat-pop my-0.5 w-[min(520px,100%)] rounded-[13px] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line2)]">
      <button type="button" onClick={() => set(false)} className="mb-1.5 flex w-full cursor-pointer items-center text-left text-[13px] font-medium">
        <span className="min-w-0 truncate">{heading ?? state}</span>
        <i className="ml-auto flex shrink-0 items-center gap-1.5 text-xs font-normal text-ink3 not-italic">
          {items.length > 0 && `${done} of ${items.length}`}
          {items.length > 0 && time && " · "}
          {time}
          <ChevronUp className="size-3.5" />
        </i>
      </button>
      {items.map((s) => (
        <Step key={s.key} state={s.state} right={s.right}>
          {s.label}
        </Step>
      ))}
      {children}
      {kind === "working" && onStop && (
        <Button variant="bad" size="sm" className="mt-2.5" onClick={onStop}>
          <Square className="fill-current" /> Stop
        </Button>
      )}
      {kind === "stopped" && onResume && (
        <Button variant="outline" size="sm" className="mt-2.5" onClick={onResume}>
          <Play /> Resume
        </Button>
      )}
    </div>
  );
}
