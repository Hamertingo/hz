import { useCallback, useRef } from "react";

/// A callback with an identity that outlives the render that made it.
///
/// `App` hands its memoized surfaces openers written as arrows in JSX, so their
/// identity changes on every one of its renders — and a streaming turn renders
/// `App` once per coalesced delta. Passed straight down they are what stops
/// `memo` on a child from ever hitting. The wrapper is created once and reads
/// the newest callback through a ref — the same bargain `useHotkey` makes with
/// its handler — so the child keeps one identity while still calling what the
/// parent last rendered with.
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A): R => latest.current(...args), []);
}
