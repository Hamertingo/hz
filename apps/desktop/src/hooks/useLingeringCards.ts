import { useEffect, useRef, useState } from "react";

/// How long an answered ask card holds its place before going.
///
/// Answering one and being asked the next are two separate events, so they land
/// in two commits. Removing the card on the first collapses the pane by a card's
/// height, and the second grows it straight back — which reads as everything
/// below lurching and bouncing. Waiting one beat lets the replacement arrive in
/// the same commit, turning two jumps into one small resize.
///
/// Only tuned against the fast case, which is the one that jitters: a gap longer
/// than this still clears the card first, and reads as two separate things
/// happening because it is.
const CARD_EXIT_MS = 500;

/// The cards to draw: the live set, but one beat behind when it empties.
///
/// A hook rather than component state because two places draw the same card —
/// the transcript, and the composer of the pane that owns it — and the beat has
/// to be one beat, not two running side by side.
export function useLingeringCards<T extends { requestId: string }>(pending: T[]): T[] {
  const [shown, setShown] = useState(pending);

  // Identity changes on every event, so the effect keys off the ids instead —
  // re-running it per event would set state in a loop.
  const key = pending.map((request) => request.requestId).join(" ");
  const latest = useRef(pending);
  latest.current = pending;

  useEffect(() => {
    // Arrivals are never delayed; the agent is blocked on them.
    if (latest.current.length > 0) {
      setShown(latest.current);
      return;
    }

    const timer = setTimeout(
      () => setShown((prev) => (prev.length === 0 ? prev : [])),
      CARD_EXIT_MS,
    );
    return () => clearTimeout(timer);
  }, [key]);

  return shown;
}
