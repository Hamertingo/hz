import { TraceIcon } from "@/components/chat/AgentTrace";
import { compactTokens } from "@/lib/format";

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
}: {
  /// Live reasoning-token estimate. Hidden at zero — every wait starts there,
  /// and "0 tokens" reads as stalled rather than as starting.
  tokens?: number;
}) {
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

      <span className="shimmer-text text-chat">{LABEL}</span>

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
