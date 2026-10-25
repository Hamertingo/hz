import type { MeStatus } from "@/types/events";

/// The three states the reader can be in, in the order the menu lists them. The
/// colour is a token name, never a hex, so it follows the theme.
export const STATUSES: readonly { id: MeStatus; label: string; hint: string; dot: string }[] = [
  { id: "available", label: "Available", hint: "Everything reaches you", dot: "bg-green" },
  { id: "focus", label: "Focus", hint: "Only “needs you” gets through", dot: "bg-amber" },
  { id: "away", label: "Away", hint: "Held until you are back", dot: "bg-ink4" },
];

export function statusMeta(status: MeStatus) {
  return STATUSES.find((s) => s.id === status) ?? STATUSES[0];
}

export const LANGUAGES = ["Português", "English", "Español"] as const;

/// What the sidebar writes under the reader's name.
export function statusLine(status: MeStatus): string {
  return statusMeta(status).label;
}
