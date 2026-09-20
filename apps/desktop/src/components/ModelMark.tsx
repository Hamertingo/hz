import { cn } from "@/lib/utils";
import { modelBrand } from "@/lib/modelBrand";

/// The vendor's mark beside a model's name.
///
/// Sixteen pixels, always drawn, and inert: it says who serves the model and
/// nothing else, so it is `aria-hidden` and carries no tooltip — the row's own
/// name is what a reader reads, and a mark that wanted explaining would be a mark
/// doing the wrong job. See [`modelBrand`](../lib/modelBrand.ts) for what goes in
/// it and why half of these are letters.
///
/// **Monochrome, in `currentColor`** — the mark takes the colour of the text it
/// sits beside rather than the vendor's own. A list of thirty-odd rows in thirty
/// brand colours reads as candy, and the row's own name is what has to be read;
/// one ink for every mark is what makes the column scan as a column. It is also
/// why the mark cannot come from the app's icon font: a brand mark is artwork,
/// not a glyph, even when it is drawn in one colour.
///
/// The path itself is still the vendor's, which is the whole point of carrying
/// them — a monochrome DeepSeek mark is DeepSeek's mark.
export default function ModelMark({ name, className }: { name: string; className?: string }) {
  const { paths, initial } = modelBrand(name);

  return (
    <span
      aria-hidden
      className={cn("flex size-4 shrink-0 items-center justify-center", className)}
    >
      {paths.length > 0 ? (
        <svg viewBox="0 0 24 24" className="size-3.5 fill-current opacity-70">
          {paths.map((d) => (
            // The path itself as the key: an icon of one or two, and two shapes
            // of the same icon are never the same string.
            <path key={d} d={d} />
          ))}
        </svg>
      ) : (
        // A step quieter than the name it sits beside, and smaller than the
        // marks: a letter is a stand-in, and one drawn at the same weight as the
        // logo it replaces makes the difference look like a mistake.
        <span className="text-[0.6rem] leading-none font-medium text-muted-foreground/70">
          {initial}
        </span>
      )}
    </span>
  );
}
