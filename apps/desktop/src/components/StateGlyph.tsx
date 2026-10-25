import { cn } from "@/lib/utils";

/// The three marks a todo can carry, drawn as they are in the tracker a reader
/// may know: a hollow ring for not started, a ring filled halfway for in
/// progress, and a disc with a check punched out for done. Shape carries the
/// state; the colour is the caller's.
export type StateKind = "unstarted" | "started" | "completed";

/// How far round the ring is filled, per kind. Unstarted is an empty ring.
const WEDGE: Record<StateKind, number> = { unstarted: 0, started: 0.5, completed: 1 };

/// The pie wedge from the centre of the ring, clockwise from twelve o'clock.
///
/// Hand-rolled rather than a stroke-dasharray ring: a filled pie reads at 14px,
/// where a dashed stroke reads as a dotted outline.
function wedgePath(fraction: number): string {
  if (fraction <= 0) return "";
  const angle = fraction * 2 * Math.PI;
  const x = 3.5 * Math.sin(angle);
  const y = -3.5 * Math.cos(angle);
  const sweep = fraction > 0.5 ? 1 : 0;

  return `M 3.5,3.5 L 3.5,0 A 3.5,3.5 0 ${sweep},1 ${(3.5 + x).toFixed(3)},${(3.5 + y).toFixed(3)} z`;
}

export default function StateGlyph({
  kind,
  color,
  className,
}: {
  kind: StateKind;
  color: string;
  className?: string;
}) {
  const shared = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    className: cn("size-3.5 shrink-0", className),
    "aria-hidden": true,
  };

  if (kind === "completed") {
    return (
      <svg {...shared} fill={color}>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M7 0C3.13401 0 0 3.13401 0 7C0 10.866 3.13401 14 7 14C10.866 14 14 10.866 14 7C14 3.13401 10.866 0 7 0ZM11.101 5.10104C11.433 4.76909 11.433 4.23091 11.101 3.89896C10.7691 3.56701 10.2309 3.56701 9.89896 3.89896L5.5 8.29792L4.10104 6.89896C3.7691 6.56701 3.2309 6.56701 2.89896 6.89896C2.56701 7.2309 2.56701 7.7691 2.89896 8.10104L4.89896 10.101C5.2309 10.433 5.7691 10.433 6.10104 10.101L11.101 5.10104Z"
        />
      </svg>
    );
  }

  const wedge = wedgePath(WEDGE[kind]);

  return (
    <svg {...shared}>
      <rect x="1" y="1" width="12" height="12" rx="6" stroke={color} strokeWidth="1.5" fill="none" />
      {wedge && <path d={wedge} fill={color} transform="translate(3.5,3.5)" />}
    </svg>
  );
}
