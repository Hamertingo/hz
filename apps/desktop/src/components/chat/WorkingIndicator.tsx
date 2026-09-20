import { useEffect, useMemo, useState } from "react";

import BloubAvatar from "@/components/BloubAvatar";
import { compactTokens, formatElapsed } from "@/lib/format";

/// One word, always, rather than one drawn per wait. A label that changes under
/// the reader — Working becoming Cooking a second later — says nothing about
/// what the agent is doing, and draws more attention to itself than the
/// distinction was ever worth.
///
/// **"Working", not "Thinking", and that is a correction.** This row draws where
/// nothing of the model's output is on screen yet, so it has no evidence of what
/// the wait is — and whether a model shares its reasoning is per turn, not per
/// model: probed against the same prompt nine times on the one gateway this is
/// developed on, one run streamed no reasoning at all, and four of nine sessions
/// in the app's own logs carry none. Saying "Thinking" there promised a trace
/// that then never arrived, which reads as the app losing it. The word for a wait
/// the app cannot see into is the one that is true of every wait; the reasoning
/// block says "Thinking" itself, over words that actually streamed.
const LABEL = "Working";

/// The gap-filler for every stretch where the agent is busy and the transcript
/// has nothing to show — the wait before a turn's first output, and the wait
/// after each tool result while the model composes its next move.
export default function WorkingIndicator({
  tokens = 0,
  seed,
  since,
}: {
  /// Live reasoning-token estimate. Hidden at zero — every wait starts there,
  /// and "0 tokens" reads as stalled rather than as starting.
  tokens?: number;
  /// What the bot is derived from — the session's own id, so a reader with two
  /// sessions running sees two different faces rather than one glyph in two
  /// places. Absent falls back to the app's own name, which is the same bot
  /// everywhere it appears.
  seed?: string;
  /// The stamp the reader's own press carried, which is where the wait began.
  /// The same stamp the settled line times from, so the number here and the
  /// `Worked for …` it becomes are one measurement rather than two.
  since?: string | null;
}) {
  const waited = useElapsed(since);

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {/* **The bot is the working state.** It is the same face the Agents screen
          draws for whoever this is, running through the orbit pose — so a reader
          looking at a wait is looking at *the thing that is working* rather than
          at a generic spinner. It replaces the trace's sparkle rather than
          sitting beside it: two marks on one short row is one too many, and the
          trace header is recognisable by its own shimmer and its settled text. */}
      <BloubAvatar name={seed ?? "hz"} size={18} live mood="working" />

      <span className="text-chat">
        <span className="shimmer-text">{LABEL}</span>
        {/* Outside the shimmer on purpose: a figure that changes every second
            should not also be the thing pulsing, or the row reads as noise
            rather than as a wait with a clock on it. `Worked for 2m` is what
            this becomes, so the two are one sentence in two tenses. */}
        {waited && (
          <span className="tabular-nums text-muted-foreground/70"> for {waited}</span>
        )}
      </span>

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

/// How long the reader has been waiting, ticking.
///
/// **A second, not a frame.** The count is not a measurement anybody reads
/// closely — it is the reassurance that the wait is moving — and a figure
/// redrawn sixty times a second is a number vibrating under the eye.
///
/// `null` for a stamp that cannot be read, which is the caller's cue to draw no
/// clock at all: a prompt relayed by the hz CLI carries the write time rather
/// than a press, and a row that opened on a made-up figure would be worse than
/// one that opened without it.
function useElapsed(since: string | null | undefined): string | null {
  const start = useMemo(() => (since ? Date.parse(since) : Number.NaN), [since]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!Number.isFinite(start)) return;
    // Read once on arrival, so a row that appears mid-wait opens on the wait so
    // far rather than on a zero that jumps a second later.
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [start]);

  if (!Number.isFinite(start)) return null;
  return formatElapsed(now - start);
}
