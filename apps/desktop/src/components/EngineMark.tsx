import { BRANDS } from "@/lib/brands";

/// The mark of the CLI an agent runs on: Claude in its own colour, the others in the text colour.
export default function EngineMark({ harness, size = 15 }: { harness: string; size?: number }) {
  if (harness === "claude-acp")
    return (
      <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <path fill={BRANDS.claude.hex} d={BRANDS.claude.d} />
      </svg>
    );
  if (harness === "codex-acp")
    return (
      <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <path fill="currentColor" d={BRANDS.openai.d} />
      </svg>
    );
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <rect x="8.5" y="9" width="7" height="7.5" rx=".8" fill="currentColor" opacity=".5" />
    </svg>
  );
}
