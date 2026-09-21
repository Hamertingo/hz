/// The window a BYOK model runs on when neither its provider entry nor the
/// agent's catalog has anything to say about it.
///
/// **The agent's own last step, copied rather than measured.**
/// `packages/local-runtime-v2/.../model-resolver-byok.ts` answers a custom
/// provider's window from the entry, then from the catalog the agent ships
/// (`resolution/model-catalog.ts`), and only then from its own `200_000` — so an
/// unset model whose catalog knows it is no longer drawn here, and this number
/// is what a model absent from all three runs on.
///
/// It is repeated here rather than read off the agent because there is nothing
/// to read: the resolved window is only ever stated on a usage update, and that
/// needs a session running the model. The row says `200k default` on the
/// strength of this.
export const BYOK_FALLBACK_CONTEXT = 200_000;

/// The reply budget a BYOK model runs on when its entry records none — the
/// `maxTokens` half of the same fallback, and drawn the same way.
///
/// Kept beside the context number because a row that says one and not the other
/// describes half a model, and `16k` beside a `1M` window is exactly the pair a
/// reader wants to see before trusting either.
export const BYOK_FALLBACK_OUTPUT = 16_384;

/// A token count as the rows draw it: `1M`, `200k`, `16k`.
///
/// Truncating rather than rounding to a decimal, because every number this
/// draws is one somebody published as a round figure: `1000000` is 1M and not
/// "1.0M", and `131072` reading as `131k` is the honest thing for a limit that
/// is an exact power of two.
export function compactLimit(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.floor(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}k`;
  return String(tokens);
}

/// What a model's limit will actually be, and whether anyone said so.
///
/// **`recorded` false is the state worth drawing rather than hiding.** It is
/// the whole difference between a window the reader set and the agent's
/// fallback — and a reader whose model is drawn at a fifth of its real size is
/// looking for exactly that difference.
export function limitLabel(
  limit: number | null | undefined,
  fallback: number,
): { text: string; recorded: boolean } {
  return typeof limit === "number" && limit > 0
    ? { text: compactLimit(limit), recorded: true }
    : { text: compactLimit(fallback), recorded: false };
}
