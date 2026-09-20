import type { AgentEvent } from "@/types/events";

/// The prompts the reader sent in this session, oldest first.
///
/// Read off the transcript rather than kept in a store of its own: the prompts
/// are already here, in order, and a second copy would be one more thing to keep
/// in step with the log — and one that a resumed session would start empty,
/// exactly when recalling yesterday's prompt is worth something.
///
/// **A relayed prompt is not yours.** `hz send` arrives as an ordinary
/// `user_message` from another session, so walking back into one would put
/// somebody else's sentence in the box as if you had written it.
export function recalledPrompts(events: readonly AgentEvent[]): string[] {
  const out: string[] = [];
  for (const event of events) {
    const payload = event.payload;
    if (payload.type !== "user_message") continue;
    if (payload.from) continue;

    const text = payload.text.trim();
    if (text) out.push(text);
  }
  return out;
}

/// Where the walk stands: `null` while the box holds something the reader typed,
/// otherwise the index of the prompt being shown. `history.length` is the *empty*
/// box after the newest prompt — the position ↓ lands on before clearing it.
export type Recall = number | null;

/// What the walk is showing, or `null` when it is not the walk's box.
export function recallText(history: string[], state: Recall): string | null {
  if (state === null) return null;
  return state < history.length ? history[state] : "";
}

/// The position the walk is at, judged against what is in the box *now*, or
/// `null` when the box is no longer the walk's to move.
///
/// The draft is what decides it, and that is the whole rule: a recalled prompt is
/// editable like any other text, and the moment it differs from what was recalled
/// it has become the reader's own draft — so the arrows go back to moving the
/// caret instead of walking a history they are no longer in.
function standing(history: string[], state: Recall, draft: string): Recall {
  if (state === null) return draft === "" ? history.length : null;
  return recallText(history, state) === draft ? state : null;
}

/// One arrow key, and where it leaves the box.
///
/// `null` means the key was not the walk's — nothing to recall, the end of the
/// history, or a box the reader is editing — and the caller should let the caret
/// move as it normally would.
export function recallMove(
  history: string[],
  state: Recall,
  draft: string,
  direction: "up" | "down",
): { state: Recall; text: string } | null {
  const from = standing(history, state, draft);
  if (from === null || history.length === 0) return null;

  if (direction === "up") {
    // The oldest prompt is the end of the walk: past it there is nothing older
    // to show, and wrapping to the newest would be a loop with no bottom.
    if (from === 0) return null;
    const next = from - 1;
    return { state: next, text: history[next] };
  }

  // Already at the empty box after the newest prompt.
  if (from >= history.length) return null;
  const next = from + 1;
  // Moving forward past the newest clears the box, which is the only way back to
  // a draft of your own without editing one of these.
  return { state: next, text: next < history.length ? history[next] : "" };
}
