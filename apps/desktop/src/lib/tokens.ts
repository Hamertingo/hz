/// Four characters to a token, rounded up. A guess, and the screen says so: the
/// real count belongs to the model's tokenizer, which this app does not carry.
/// The backend uses the same rule for the parts of the briefing, so the live
/// count beside the editor and the saved layers never disagree.
export function estimateTokens(text: string): number {
  return Math.ceil([...text].length / 4);
}

/// "112 tok" at the grain a layer row is read at.
export function tokLabel(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(0)}k tok` : `${n.toLocaleString("en-US")} tok`;
}
