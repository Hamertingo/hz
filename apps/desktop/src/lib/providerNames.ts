import type { Provider } from "@/types/events";

/// What a provider is *called*, where the picker only has its id.
///
/// The agent names a model's provider by its id and nothing else —
/// `m:custom_provider:opencode-go:glm-5.3:v:` and no field anywhere on the wire
/// carrying "OpenCode Go". The one place that pair exists is `provider list`,
/// which the settings screen already reads, so this is a cache it fills rather
/// than a second call of its own: the picker draws a group heading on every open,
/// and a boot of the agent for a label is not a price a heading may carry.
///
/// **The fallback is the id's own slug, prettified**, because a picker that draws
/// `custom_provider:opencode-go` over a group is a picker nobody can read — and
/// one that draws no heading at all is worse, since the whole point of the
/// grouping is telling two providers apart. Settings being opened once makes the
/// names exact for the rest of the run; until then `Opencode Go` is a worse name
/// than `OpenCode Go` and a much better one than the id.
///
/// Replaced rather than mutated, so a subscriber can tell a new reading from the
/// same one by identity.
let snapshot: Record<string, string> = {};
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// The names known so far, as a stable object so a subscriber can compare.
export function knownProviderNames(): Record<string, string> {
  return snapshot;
}

export function subscribeProviderNames(listener: () => void): () => void {
  return subscribe(listener);
}

/// Remembers one reading of `provider list`. Merged rather than replaced: a
/// provider removed since the last read keeps its name, which is what lets a
/// session still on a model from it draw a heading rather than an id.
export function rememberProviderNames(providers: Provider[]): void {
  const next = { ...snapshot };
  let changed = false;

  for (const provider of providers) {
    if (next[provider.providerId] === provider.name) continue;
    next[provider.providerId] = provider.name;
    changed = true;
  }

  if (!changed) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/// What to draw over a group of models.
export function providerLabel(id: string, known: Record<string, string>): string {
  return known[id] ?? prettifyProviderId(id);
}

/// The id's last segment, which is the slug the CLI minted from the name it was
/// given: `custom_provider:opencode-go` is OpenCode Go's.
function prettifyProviderId(id: string): string {
  const slug = id.split(":").filter(Boolean).pop() ?? id;

  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
