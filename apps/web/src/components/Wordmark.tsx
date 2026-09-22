/// The app mark and name: the hz cat, from `public/hz-cat-plain.svg`.
///
/// The plain cut of the art — the same drawing with the near-black tile behind
/// it dropped. On its tile the mark carries a square that is only invisible
/// against the exact colour the artwork was composed on, and this page's
/// background is not it: `hz-cat.svg` here drew a faint box around a 17px cat.
/// Without the tile the cat sits on whatever it is placed over.
///
/// An `<img>` rather than the inline `currentColor` path this used to be. The
/// mark is painted in its own colours now — a purple cat with a cream face —
/// and taking the page's text colour would throw every one of them away.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
      role="img"
      aria-label="hz"
    >
      <img src="/hz-cat-plain.svg" alt="" className="h-[1.15em] w-[1.15em] shrink-0" />
      <span className="font-semibold leading-none tracking-tight">hz</span>
    </span>
  );
}
