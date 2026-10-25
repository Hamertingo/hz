import { MASCOT_COLORS } from "@/lib/mascots";
import { cn } from "@/lib/utils";

/// The eight colours a face or a workspace can wear, as round buttons. The
/// chosen one gets a ring in the page's ink, offset by a gap of the surface it
/// sits on, so it reads on any theme.
export default function Swatches({
  value,
  onChange,
  size = 20,
  label = "Colour",
}: {
  value: string;
  onChange: (color: string) => void;
  size?: number;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      {MASCOT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          onClick={() => onChange(c)}
          style={{ background: c, width: size, height: size }}
          className={cn(
            "cursor-pointer rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/60",
            c === value && "shadow-[0_0_0_2px_var(--pop),0_0_0_4px_var(--ink)]",
          )}
        />
      ))}
    </div>
  );
}
