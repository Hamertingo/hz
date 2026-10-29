import Orb from "@/components/Orb";

/// Standing notice that async work is still going — driven by the latest
/// `background_tasks_changed` set, so it outlives the turn that spawned the
/// tasks and leaves when the set drains. A line, not a control: nothing opens
/// from it, and the transcript's own rows say what the work is.
export default function BackgroundTasksIndicator({ count }: { count: number }) {
  const label = `${count} Background Task${count === 1 ? "" : "s"}`;

  return (
    <div className="flex items-center gap-2">
      {/* Same 20px inline design as WorkingIndicator, `weaving` so the two
          read as different activities at a glance. Theme pinned for the same
          reason as there: the orb's `auto` expects `data-theme="dark|light"`
          and this app stamps a palette name instead. */}
      <Orb state="weaving" size={20} aria-hidden />

      <span className="shimmer-text text-chat">{label}</span>
    </div>
  );
}
