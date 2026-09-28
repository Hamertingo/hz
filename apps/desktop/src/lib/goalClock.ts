/// When a goal's clock is measured from, and what it reads.
///
/// Split out of the band that draws it, because the failure these prevent is
/// invisible for as long as the reader stays put: the figure looks right the whole
/// time it is wrong, and only leaving the chat and coming back shows it. Logic of
/// that shape is what this repo tests.

/// A goal's clock, anchored.
export type GoalBaseline = {
  /// The runtime's own count at the moment of the stamp — the number the band
  /// adds its own seconds onto.
  seconds: number;
  /// The local clock when that figure arrived, which is what the interpolation
  /// runs against until the next push.
  at: number;
};

/// The anchor to measure from, given whatever is already held for this goal.
///
/// **A figure that did not move is not a new anchor.** The runtime pushes
/// `timeUsedSeconds` when something in the goal moves rather than on a schedule, so
/// most pushes carry the number that was already there — and restamping on each of
/// them, mount included, is what made leaving the chat reset the clock: the band
/// remounts carrying the last figure it ever saw, took it as a fresh start, and
/// dropped every second it had counted in between. Only a figure that actually
/// changed is a new starting point.
///
/// A figure that moved *backwards* is still the runtime's own, so it restamps too:
/// the band reports what it was told rather than the largest number it has seen.
export function goalBaseline(
  held: GoalBaseline | undefined,
  seconds: number,
  now: number,
): GoalBaseline {
  if (held && held.seconds === seconds) return held;
  return { seconds, at: now };
}

/// What the band draws: the runtime's count plus the seconds since it landed.
///
/// **Clamped at zero, because these are two different clocks.** The figure is the
/// runtime's and the anchor is local, so a machine whose clock steps backwards
/// between the push and the draw must not show a goal that has been running for a
/// minute as a negative one.
export function elapsedSeconds(baseline: GoalBaseline, now: number): number {
  return baseline.seconds + Math.max(0, Math.floor((now - baseline.at) / 1_000));
}
