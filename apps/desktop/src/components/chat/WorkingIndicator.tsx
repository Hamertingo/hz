import { useState } from "react";

import { TraceIcon } from "@/components/chat/AgentTrace";
import { compactTokens } from "@/lib/format";

/// "Thinking" is one of these rather than a label the harness switches on. It is
/// accurate often enough, and a word that changes under the reader — Working
/// becoming Thinking a second later — draws more attention to itself than the
/// distinction is worth. Nobody is waiting to be told which kind of wait this is.
const LABELS = ["Working", "Cooking", "Brewing", "Thinking"];

/// The gap-filler for every stretch where the agent is busy and the transcript
/// has nothing to show — the wait before a turn's first output, and the wait
/// after each tool result while the model composes its next move.
export default function WorkingIndicator({
  tokens = 0,
}: {
  /// Live reasoning-token estimate. Hidden at zero — every wait starts there,
  /// and "0 tokens" reads as stalled rather than as starting.
  tokens?: number;
}) {
  // Picked once per mount, so it's one word per wait rather than one per render.
  // The indicator unmounts as soon as content takes over, so each wait still
  // draws its own word.
  const [label] = useState(() => LABELS[Math.floor(Math.random() * LABELS.length)]);

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {/* The trace's own glyph, so the live row and the header a trace settles
          behind are recognisably the same thing — this is that header, before
          there is anything behind it. `text-muted-foreground/70` matches the
          trace header's, so the two do not shift colour as one becomes the
          other. */}
      <span className="shrink-0 text-muted-foreground/70">
        <TraceIcon className="size-3.5" />
      </span>

      <span className="shimmer-text text-chat">{label}</span>

      {/* Dimmer than the label and deliberately unshimmered: the count is the
          one part of this row that is really moving, so it doesn't need the
          animation to say so, and pairing the two just made the row noisy. */}
      {tokens > 0 && (
        <span className="text-chat text-muted-foreground/60 tabular-nums">
          {compactTokens(tokens)} tokens
        </span>
      )}
    </div>
  );
}
