import type { ProviderCheck } from "@/types/events";

/// The three pure halves of a provider model check, kept out of the component
/// because each of them is wrong in a way nobody sees on screen.

/// A reading as it arrives: absent for a provider nothing has asked yet, and
/// `null` — the same fact in the shape the bridge sends an absent `Option` in.
export type ProviderReading = ProviderCheck | null | undefined;

/// How long a reading is drawn as current.
///
/// **The same ten minutes the model probe is trusted for** (`models.rs`'s
/// `FRESH_FOR`). The two answer one question one step apart — the probe reads
/// the agent's list, a check reads the gateway's — and a reader comparing the two
/// screens should not be able to see them disagree about how stale "recent" is.
export const CHECK_FRESH_FOR_MS = 10 * 60 * 1000;

/// Whether a card should ask the gateway as it opens.
///
/// **Never asked is its own answer, not the oldest possible reading.** A provider
/// connected a minute ago has no check because nothing has asked yet, and it is
/// exactly the one worth asking about — which a `checkedAt` of zero would also
/// give, but only by accident of the epoch.
export function checkDue(check: ProviderReading, now: number): boolean {
  if (!check) return true;
  return now - check.checkedAt >= CHECK_FRESH_FOR_MS;
}

/// How long ago a reading was taken, in the shortest form that is still true.
///
/// Rounded rather than truncated, so 59 seconds reads as `1m ago` rather than as
/// `just now` twice in a row — and never negative, since the socket can carry a
/// reading back from a clock that is a moment ahead of this one.
export function checkedAgo(check: ProviderCheck, now: number): string {
  const seconds = Math.max(0, Math.round((now - check.checkedAt) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

/// The one line under a provider's model list, or `null` where the rows already
/// say everything there is to say.
///
/// **One line, because the header it sits under is one line** — the count and the
/// timestamp are beside it, and a paragraph here would push the list itself down
/// for a fact about the list. The two that survive are the two a reader acts on:
/// a gateway that refused, and a list that changed. A check that found nothing
/// new says nothing at all.
export function checkSummary(check: ProviderCheck): { text: string; bad: boolean } | null {
  if (check.outcome === "failed") {
    return { text: check.error ?? "The gateway did not answer.", bad: true };
  }
  if (check.outcome === "empty") {
    return { text: "The gateway serves nothing this build can register.", bad: false };
  }

  const parts = [
    check.added > 0 ? `${check.added} new` : null,
    // **Not "gone", and not removed either**: a list endpoint is the gateway's
    // own view of itself, so what this states is what the reply did not carry.
    // See `providers::check`, which reports these rather than deleting them.
    check.missing.length > 0 ? `${check.missing.length} not listed by the gateway` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? { text: parts.join(" · "), bad: false } : null;
}
