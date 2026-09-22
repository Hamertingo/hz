import Orb from "@/components/Orb";

/// Shown while the CLI rewrites the conversation into a summary.
///
/// It earns a live indicator rather than a settled row because it takes real
/// time — seconds on a small conversation, over two minutes on a full one — with
/// nothing else on screen to explain the wait.
///
/// **Not driven by events, and that is the reversal worth knowing about.** It
/// was written for `context_compaction_started`/`context_compacted`, a pair this
/// app's earlier harnesses emitted and the CLI it runs now does not: mcode's ACP
/// vocabulary has no compaction update at all, so for the whole life of the
/// mcode harness this line could not appear. What drives it is the prompt the
/// reader sent — see `compactingOf`, which is where that rule and its two blind
/// spots are written down.
///
/// The counts a finished compaction is worth are not missing: the CLI answers
/// the command with them as text, and that answer is in the transcript as an
/// ordinary message.
export default function CompactingIndicator() {
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {/* Same 20px inline design as WorkingIndicator, `shaping` so it reads as
          a third distinct activity next to `working` and `weaving`. Theme
          pinned for the same reason as there: the orb's `auto` expects
          `data-theme="dark|light"` and this app stamps a palette name. */}
      <Orb state="shaping" size={20} aria-hidden />

      <span className="shimmer-text text-chat">Compacting context</span>
    </div>
  );
}
