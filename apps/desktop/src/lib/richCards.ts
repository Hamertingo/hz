import type { RichCardData } from "@/components/chat/cards";

const FENCE = /```hz-card[ \t]*\n([\s\S]*?)\n```[ \t]*/g;

/// Pulls the cards an agent posted out of its message, split by whether they come before its words or after. A card is a fenced block tagged `hz-card` that
/// holds one JSON `RichCardData`; the rest of the text is what is said. A block that does not parse stays
/// in the text, so a malformed card shows as code instead of vanishing.
export function splitCards(text: string): { text: string; before: RichCardData[]; cards: RichCardData[] } {
  if (!text.includes("```hz-card")) return { text, before: [], cards: [] };
  const before: RichCardData[] = [];
  const cards: RichCardData[] = [];
  let words = false;
  const rest = text.replace(FENCE, (whole, body: string, at: number) => {
    try {
      const card = JSON.parse(body) as RichCardData;
      if (card && typeof card.type === "string") {
        // A card ahead of every word sits above the message, the way a voice memo leads its transcript.
        (words || text.slice(0, at).trim() ? cards : before).push(card);
        words = words || Boolean(text.slice(0, at).trim());
        return "";
      }
    } catch {
      // Left in place below.
    }
    return whole;
  });
  return { text: rest.trim(), before, cards };
}
