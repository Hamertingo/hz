import { BRANDS, type BrandSlug } from "@/lib/brands";
import { cn } from "@/lib/utils";

/// A brand's mark on a paper tile, the way an app icon sits on a shelf, or
/// `bare` in the surrounding text colour for a mark that sits on the dark page.
/// An unknown slug draws a plain square rather than nothing, so a custom plugin
/// still has a shape in the list.
export default function BrandMark({
  slug,
  size = 28,
  bare = false,
  className,
}: {
  slug: string;
  size?: number;
  bare?: boolean;
  className?: string;
}) {
  const brand = BRANDS[slug as BrandSlug];
  const glyph = Math.round(size * (bare ? 1 : 0.56));
  const mark = (
    <svg aria-hidden width={glyph} height={glyph} viewBox="0 0 24 24" className="shrink-0">
      {brand ? (
        <path fill={bare ? "currentColor" : brand.hex} d={brand.d} />
      ) : (
        <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-neutral-600" />
      )}
    </svg>
  );
  if (bare) return <span className={cn("inline-flex", className)}>{mark}</span>;
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center bg-(--paper) shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      {mark}
    </span>
  );
}
