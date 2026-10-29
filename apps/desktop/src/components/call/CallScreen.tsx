import { Mic, MicOff, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import Dither from "@/components/Dither";
import { kit } from "@/lib/kit";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

export type CallSummary = { seconds: number; lines: string[] };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const BTN = "grid size-[50px] cursor-pointer place-items-center rounded-full bg-s3 text-ink transition-colors hover:bg-line3 [&_svg]:size-5";

/// A voice call: the agent's face breathing in the middle, a timer, the line it is saying now, and mute,
/// speaker and end. `live` is the newest thing it said, fed by the caller; the lines are kept for the
/// summary. Ending hands the summary back, and the caller decides where it lands in the chat.
export default function CallScreen({
  agent,
  label,
  live,
  onEnd,
}: {
  agent: Pick<RosterAgent, "id" | "name" | "kind" | "color" | "shape" | "look" | "photo">;
  /// A name to show in place of the agent's, for a channel's lead taking the call.
  label?: string;
  live?: string;
  onEnd: (summary: CallSummary) => void;
}) {
  const t0 = useRef(Date.now());
  const [secs, setSecs] = useState(0);
  const [link, setLink] = useState<"connecting" | "live" | "down">("connecting");
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const lines = useRef<string[]>([]);
  const ended = useRef(false);

  useEffect(() => {
    let off = false;
    kit
      .callStart(agent.id)
      .then(() => !off && setLink("live"))
      .catch(() => !off && setLink("down"));
    const iv = window.setInterval(() => setSecs(Math.floor((Date.now() - t0.current) / 1000)), 500);
    return () => {
      off = true;
      window.clearInterval(iv);
    };
  }, [agent.id]);

  useEffect(() => {
    if (live && lines.current.at(-1) !== live) lines.current.push(live);
  }, [live]);

  const end = async () => {
    if (ended.current) return;
    ended.current = true;
    let summary = lines.current;
    try {
      const back = await kit.callEnd(agent.id);
      if (back.length) summary = back;
    } catch {
      /* the lines heard here are the summary */
    }
    onEnd({ seconds: Math.max(1, Math.floor((Date.now() - t0.current) / 1000)), lines: summary });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void end();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const said = live ?? (link === "down" ? "Voice isn't connected in this build yet. You can still hang up." : "");

  return (
    <div
      role="dialog"
      aria-label={`Call with ${label ?? agent.name}`}
      style={{ ["--c" as string]: agent.color }}
      className="absolute inset-0 z-40 flex animate-in flex-col items-center justify-center gap-1.5 bg-background duration-200 fade-in-0"
    >
      <div className="absolute inset-x-0 top-0 h-(--titlebar-h)" data-tauri-drag-region="deep" />
      <div className="absolute inset-0 overflow-hidden opacity-[0.16] blur-[18px]" aria-hidden>
        <Dither color={agent.color} seed={`call${agent.id}`} cols={120} rows={80} light={0.8} />
      </div>
      <div className="call-orb relative mb-[18px] grid size-[150px] place-items-center rounded-full">
        <AgentAvatar agent={agent} size={110} pose="work" />
      </div>
      <h2 className="relative text-xl font-semibold tracking-[-0.02em]">{label ?? agent.name}</h2>
      <div className="relative text-[13px] text-ink3 tabular-nums">{link === "connecting" && secs < 2 ? "Connecting…" : clock(secs)}</div>
      <div className={cn("call-wave relative mt-4 mb-1.5 flex h-[34px] items-center gap-[3px]", (muted || link === "down") && "paused")} aria-hidden>
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} style={{ height: 10 + ((i * 7) % 22), animationDelay: `${(i % 6) * 0.09}s` }} />
        ))}
      </div>
      <p className="relative min-h-[42px] max-w-[420px] text-center text-[13.5px] leading-[1.55] text-ink2" aria-live="polite">
        {said}
      </p>
      <div className="relative mt-[22px] flex gap-3.5">
        <button type="button" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted((m) => !m)} className={cn(BTN, muted && "bg-ink text-background hover:bg-ink")}>
          {muted ? <MicOff /> : <Mic />}
        </button>
        <button type="button" aria-label="Speaker" aria-pressed={speaker} onClick={() => setSpeaker((s) => !s)} className={cn(BTN, speaker && "bg-ink text-background hover:bg-ink")}>
          {speaker ? <Volume2 /> : <VolumeX />}
        </button>
        <button type="button" aria-label="End call" onClick={() => void end()} className={cn(BTN, "bg-red text-white hover:bg-red/90")}>
          <PhoneOff />
        </button>
      </div>
    </div>
  );
}
