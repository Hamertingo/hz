import Orb from "@/components/Orb";

/// Standing notice that async work is still going — driven by the latest
/// `background_tasks_changed` set, so it outlives the turn that spawned the
/// tasks and leaves when the set drains.
///
/// A button where there is a subagent to open, because this is the one row on
/// screen that says work is happening somewhere the transcript does not show it,
/// and the subagent's own conversation is where that work is. `onOpen` absent
/// means the session has none — a background task is not a subagent — and the row
/// draws as a line instead: a control that opened nothing would be one the reader
/// presses twice before believing it.
///
/// No chevron and no hover chrome. `SubagentRow` earns one by sitting in a column
/// of rows that mostly do not open anything; this sits alone below the
/// transcript, where the affordance is the row itself.
export default function BackgroundTasksIndicator({
  count,
  onOpen,
}: {
  count: number;
  /// Absent when there is nothing to open. See above.
  onOpen?: () => void;
}) {
  const label = `${count} Background Task${count === 1 ? "" : "s"}`;

  const inner = (
    <>
      {/* Same 20px inline design as WorkingIndicator, `weaving` so the two
          read as different activities at a glance. Theme pinned for the same
          reason as there: the orb's `auto` expects `data-theme="dark|light"`
          and this app stamps a palette name instead. */}
      <Orb state="weaving" size={20} aria-hidden />

      <span className="shimmer-text text-chat">{label}</span>
    </>
  );

  if (!onOpen) {
    return <div className="flex items-center gap-2">{inner}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Show ${count} background task${count === 1 ? "" : "s"}`}
      className="flex cursor-pointer items-center gap-2 text-left"
    >
      {inner}
    </button>
  );
}
