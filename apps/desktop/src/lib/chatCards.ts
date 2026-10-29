import { fileTarget, teamTool } from "@/lib/tools";
import { isToolGroup, type WorkItem } from "@/lib/transcript";
import type { ToolResult } from "@/types/events";

/// A document an agent wrote in a turn, drawn as a card under its message.
export type FileCard = { kind: "file"; path: string; name: string };

/// A pull request a turn opened or named by its URL.
export type PrCard = {
  kind: "pr";
  number: number;
  repo: string;
  url: string;
};

export type ChatCard = FileCard | PrCard;

/// Extensions worth a card. A coding agent edits dozens of source files in one
/// turn and a card for each would bury the message; what it *made for the reader
/// to read* is prose and data.
const DOC_EXT = new Set(["md", "mdx", "txt", "rst", "csv", "tsv", "json", "yaml", "yml", "html"]);

/// Most cards one message carries. More is a file listing, and the steps below
/// it already hold that.
export const MAX_CARDS = 3;

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

/// Every pull request URL in `text`, once each, in the order they appear.
export function findPrUrls(text: string): PrCard[] {
  const seen = new Set<string>();
  const out: PrCard[] = [];
  for (const m of text.matchAll(PR_URL)) {
    const key = `${m[1]}#${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "pr", number: Number(m[2]), repo: m[1], url: m[0] });
  }
  return out;
}

/// Whether `path` is a document a card should offer.
export function isDocPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  // Dotfiles and anything under a hidden directory are tooling, not deliverables.
  if (path.split("/").some((part) => part.startsWith(".") && part.length > 1)) return false;
  return DOC_EXT.has(name.slice(dot + 1).toLowerCase());
}

/// The cards for one turn: documents it wrote (with a `Write`-style tool, not an
/// edit of an existing source file), then pull requests its shell calls or its
/// final words name. Documents come first because a PR link is usually also in
/// the words and the card is the thing to open.
export function cardsOf(
  work: readonly WorkItem[],
  resultByCallId: ReadonlyMap<string, ToolResult>,
  finalText: string | null,
): ChatCard[] {
  const files = new Map<string, FileCard>();
  let shellText = "";

  for (const item of work) {
    const events = isToolGroup(item) ? item.calls : [item];
    for (const e of events) {
      const p = e.payload;
      if (p.type !== "tool_call_started" || teamTool(p.name)) continue;
      if (p.toolType === "file_edit" && /write|create/i.test(p.name)) {
        const path = fileTarget(p.toolType, p.input);
        if (path && isDocPath(path) && !files.has(path)) {
          files.set(path, { kind: "file", path, name: path.split("/").pop() ?? path });
        }
      }
      if (p.toolType === "shell") shellText += `\n${resultByCallId.get(p.callId)?.text ?? ""}`;
    }
  }

  const prs = findPrUrls(`${shellText}\n${finalText ?? ""}`);
  return [...files.values(), ...prs].slice(0, MAX_CARDS);
}
