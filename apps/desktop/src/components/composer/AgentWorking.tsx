import { Square } from "lucide-react";
import { useEffect, useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import { useAgentGlances } from "@/hooks/useAgentGlances";
import { inkTint } from "@/lib/mascots";
import type { RosterAgent } from "@/lib/roster";

/// `m:ss` from a start stamp to now, redrawn every second.
function useElapsed(since: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!since) return null;
  const start = Date.parse(since);
  if (Number.isNaN(start)) return null;
  const s = Math.max(0, Math.floor((now - start) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/// The pill over the composer while an agent works: its face, what it is doing
/// right now, how long the turn has run, and a stop. The transcript says what it
/// did step by step; this says it is still doing it, wherever the reader has
/// scrolled to.
export default function AgentWorking({
  agent,
  sessionId,
  since,
  onStop,
}: {
  agent: RosterAgent;
  sessionId: string;
  /// When the turn began, for the clock.
  since: string | null;
  onStop: () => void;
}) {
  const elapsed = useElapsed(since);
  const doing = useAgentGlances([sessionId])[sessionId]?.doing;

  return (
    <div className="mb-2 flex justify-start">
      <div
        className="flex items-center gap-2 rounded-full py-1 pr-1 pl-1.5 text-ui backdrop-blur-xl"
        style={{
          background: `${agent.color}24`,
          boxShadow: `inset 0 0 0 1px ${agent.color}40`,
        }}
      >
        <AgentAvatar agent={agent} size={20} />
        <span className="font-medium" style={{ color: inkTint(agent.color, 0.45) }}>
          {agent.name}
        </span>
        <span className="shimmer-text max-w-[320px] truncate text-muted-foreground">
          {doing ? `is ${doing.charAt(0).toLowerCase()}${doing.slice(1)}` : "is working…"}
        </span>
        {elapsed && (
          <span className="text-[11.5px] tabular-nums text-muted-foreground/80">{elapsed}</span>
        )}
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          title="Stop"
          className="flex size-6 cursor-pointer items-center justify-center rounded-full bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Square className="size-2.5 fill-current" />
        </button>
      </div>
    </div>
  );
}
