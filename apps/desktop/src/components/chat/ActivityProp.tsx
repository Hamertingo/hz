import type { Activity } from "@/lib/agentStatus";

/// The little object the mascot holds for what it is doing: its own computer (a monitor with a scrolling screen),
/// your Mac (a laptop, keys tapping), the web (a magnifier sweeping), a page it reads (lines being scanned), code or
/// words it writes (a pencil scribbling), a thought (a bubble filling). Drawn small and in ink, so it reads as part
/// of the mascot and not as an icon beside it. Animated in `styles/agent-status.css`.
export default function ActivityProp({ activity }: { activity: Activity }) {
  const kind = PROP[activity];
  if (!kind) return null;
  return (
    <svg className={`aprop aprop-${kind}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      {kind === "monitor" && (
        <>
          <rect x="1.5" y="2" width="13" height="9" rx="1.6" className="aprop-body" />
          <g className="aprop-scroll">
            <rect x="3.5" y="4" width="6" height="1.1" rx=".55" />
            <rect x="3.5" y="6" width="8" height="1.1" rx=".55" />
            <rect x="3.5" y="8" width="5" height="1.1" rx=".55" />
            <rect x="3.5" y="10" width="7" height="1.1" rx=".55" />
          </g>
          <path d="M6 13.8h4M8 11v2.8" className="aprop-stroke" />
        </>
      )}
      {kind === "laptop" && (
        <>
          <rect x="3" y="3" width="10" height="7" rx="1.3" className="aprop-body" />
          <rect x="4.6" y="4.6" width="6.8" height="3.8" rx=".6" className="aprop-glow" />
          <path d="M1.5 12.2h13" className="aprop-stroke aprop-tap" />
        </>
      )}
      {kind === "magnifier" && (
        <g className="aprop-sweep">
          <circle cx="7" cy="7" r="4" className="aprop-ring" />
          <path d="M10 10l3.6 3.6" className="aprop-stroke" />
        </g>
      )}
      {kind === "page" && (
        <>
          <rect x="3" y="1.5" width="10" height="13" rx="1.5" className="aprop-body" />
          <path d="M5 5h6M5 7.5h6M5 10h4" className="aprop-lines" />
          <rect x="4.4" y="4.2" width="7.2" height="1.6" rx=".8" className="aprop-scan" />
        </>
      )}
      {kind === "pencil" && (
        <g className="aprop-write">
          <path d="M3 13l1-3.4 7-7a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2l-7 7z" className="aprop-body" />
          <path d="M3 13l3-.6" className="aprop-stroke" />
        </g>
      )}
      {kind === "bubble" && (
        <>
          <circle cx="2.6" cy="14" r="1" className="aprop-body aprop-tail" />
          <rect x="3.5" y="3" width="12" height="7.4" rx="3.7" className="aprop-body" />
          <circle cx="6.6" cy="6.7" r=".95" className="aprop-dot" />
          <circle cx="9.5" cy="6.7" r=".95" className="aprop-dot aprop-d2" />
          <circle cx="12.4" cy="6.7" r=".95" className="aprop-dot aprop-d3" />
        </>
      )}
    </svg>
  );
}

const PROP: Partial<Record<Activity, "monitor" | "laptop" | "magnifier" | "page" | "pencil" | "bubble">> = {
  computer: "monitor",
  mac: "laptop",
  web: "magnifier",
  searching: "magnifier",
  reading: "page",
  code: "pencil",
  writing: "pencil",
  thinking: "bubble",
  reflecting: "bubble",
  planning: "bubble",
};
