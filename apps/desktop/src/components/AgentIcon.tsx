import claudeIcon from "@lobehub/icons-static-svg/icons/claude.svg?raw";
import codexIcon from "@lobehub/icons-static-svg/icons/codex.svg?raw";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg?raw";

import { pathsOf } from "@/lib/modelBrand";
import { cn } from "@/lib/utils";
import type { Harness } from "@/types/events";

/// The marks of the three CLIs hz runs on the reader's own install.
///
/// Their vendors' own artwork, from the same MIT icon set the model picker draws
/// from, and for the same reason: it names what is about to run, which is what a
/// vendor mark is for. Monochrome in `currentColor`, so a row of them reads as a
/// column rather than as three brand colours.
const MARKS: Partial<Record<Harness, { paths: string[]; label: string }>> = {
  "claude-acp": { paths: pathsOf(claudeIcon), label: "Claude" },
  "codex-acp": { paths: pathsOf(codexIcon), label: "Codex" },
  opencode: { paths: pathsOf(opencodeIcon), label: "OpenCode" },
};

/// The agent hz used to ship, drawn for the sessions it wrote.
///
/// **A monogram of its name, and that is not a placeholder.** It was this app's
/// own build, so there is no vendor mark to carry; a glyph traced from somebody's
/// brand would be claiming an identity that is not that brand's to give.
function HzAgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Hz Agent"
    >
      <path d="M4 8v9M4 12.5h5M9 8v9" />
      <path d="M15 8h5l-5 9h5" />
    </svg>
  );
}

export default function AgentIcon({
  harness,
  className,
}: {
  harness: Harness;
  className?: string;
}) {
  const mark = MARKS[harness];
  if (!mark) return <HzAgentIcon className={className} />;

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0 fill-current", className)}
      fillRule="evenodd"
      role="img"
      aria-label={mark.label}
    >
      {mark.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
