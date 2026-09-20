import { useSyncExternalStore } from "react";

/// A read that has been running long enough to be worth mentioning.
///
/// Wraps an `invoke` at the call site rather than the `invoke` helper itself: a
/// shim would cover `send_msg` too, and a send already has an indicator of its
/// own — two things saying "working" about one action is one too many. The call
/// sites are the reads that otherwise leave an empty pane and say nothing while
/// they do.
///
/// One line at a time, and it names the *oldest* read still running: a second
/// slow read is not a second wait, it is the same wait from another angle, and
/// stacking them turns one sentence into a wall. The line follows the oldest one
/// left when the read that owned it lands, and only goes once nothing is slow.
const SLOW_MS = 4_000;

/// How long the line stays after the last read lands. Long enough to be read by
/// somebody who looked up when it appeared; short enough that it is never there
/// once the work is done and forgotten.
const LINGER_MS = 2_000;

type State = { label: string } | null;

/// Insertion-ordered, so the first entry is the read that started first.
const inflight = new Map<number, string>();
let nextId = 0;
let state: State = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function oldest(): string | null {
  for (const label of inflight.values()) return label;
  return null;
}

function emit(next: State) {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// What the toast draws, or `null`.
export function slowRequest(): State {
  return state;
}

export function useSlowRequest(): State {
  return useSyncExternalStore(subscribe, slowRequest);
}

/// Runs `work`, and past `SLOW_MS` says what is being read.
///
/// Returns the same promise, so a call site only wraps: the sentence names the
/// read, never the command, since nobody knows what a `list_session_index_items`
/// is.
export function tracked<T>(label: string, work: Promise<T>): Promise<T> {
  const id = ++nextId;
  inflight.set(id, label);
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }

  const timer = setTimeout(() => {
    if (!state) emit({ label: oldest() ?? label });
  }, SLOW_MS);

  const settle = () => {
    // A failure settles it too: the composer's error slot says what went wrong,
    // and "reading…" beside it describes a read that is over.
    clearTimeout(timer);
    if (!inflight.delete(id)) return;
    const stillSlow = oldest();
    if (stillSlow) {
      if (state) emit({ label: stillSlow });
      return;
    }
    if (!state) return;
    clearTimer = setTimeout(() => {
      clearTimer = null;
      emit(null);
    }, LINGER_MS);
  };

  return work.then(
    (value) => {
      settle();
      return value;
    },
    (error) => {
      settle();
      throw error;
    },
  );
}

/// Drops the line. What the toast's own dismiss calls, and the only way out
/// while a read is still running.
export function dismissSlow(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  emit(null);
}
