import { invoke } from "@tauri-apps/api/core";

/// A note for an agent's memory folder, made from words the reader picked out of
/// the chat.
///
/// Plain Markdown, because the folder is shared with the agent's own file tools
/// and the memory tab: a header line the reader can recognise, the words, and a
/// provenance line saying where it came from.
export function noteFor(text: string, now: Date): { name: string; title: string; content: string } {
  const flat = text.replace(/\s+/g, " ").trim();
  const title = flat.length > 60 ? `${flat.slice(0, 58).trimEnd()}…` : flat || "Note";
  const slug =
    flat
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "note";
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const day = now.toISOString().slice(0, 10);
  return {
    name: `chat-${slug}-${stamp}.md`,
    title,
    content: `# ${title}\n\n${text.trim()}\n\n_Saved from the chat on ${day}._\n`,
  };
}

/// `index` with a line for `note` added, unless it already lists the file. The
/// agent reads the index first, so a note it cannot find from there is a note it
/// does not have.
export function withIndexLine(index: string, note: { name: string; title: string }): string {
  if (index.includes(`(${note.name})`)) return index;
  const line = `- [${note.title}](${note.name}) — saved from chat`;
  const body = index.trimEnd();
  return body ? `${body}\n${line}\n` : `${line}\n`;
}

/// Writes the note and files it in the index. Returns the note's file name.
export async function rememberInChat(agentId: string, text: string): Promise<string> {
  const note = noteFor(text, new Date());
  await invoke("agent_memory_write", { agentId, name: note.name, content: note.content });
  let index = "";
  try {
    index = await invoke<string>("agent_memory_read", { agentId, name: "MEMORY.md" });
  } catch {
    // No index yet: the line starts it.
  }
  await invoke("agent_memory_write", {
    agentId,
    name: "MEMORY.md",
    content: withIndexLine(index, note),
  });
  return note.name;
}
