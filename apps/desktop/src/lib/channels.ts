import { formatClock } from "@/lib/clock";
import type { Channel, ChannelMessage, Mode, Task, TaskStatus } from "@/types/events";

/// A name as `channels.rs` keeps it: lower case, letters, digits and dashes. The
/// two must agree, or the form would accept a name the backend files under
/// another one.
export function slugName(input: string): string {
  let out = "";
  for (const c of input.trim().toLowerCase()) {
    if (/[a-z0-9]/.test(c)) out += c;
    else if (!out.endsWith("-")) out += "-";
  }
  return out.replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

/// Why the form cannot save yet, in a sentence, or null when it can.
export function channelProblem(input: {
  name: string;
  members: readonly string[];
  channels: readonly Channel[];
  workspaceId: string | null;
  /// The channel being edited, which may keep its own name.
  editing?: string | null;
}): string | null {
  const name = slugName(input.name);
  if (!name) return "A channel needs a name.";
  if (input.members.length === 0) return "Pick at least one agent.";
  const taken = input.channels.some(
    (c) => c.id !== input.editing && !c.archived && c.workspaceId === input.workspaceId && c.name === name,
  );
  return taken ? `#${name} already exists.` : null;
}

/// The people an `@` list can name, as far as routing is concerned.
export type Named = { id: string; name: string };

function hits(text: string, names: readonly string[]): number[] {
  const chars = [...text.toLowerCase()];
  const wanted = names.map((n) => [...n.trim().toLowerCase()]);
  const out: number[] = [];
  chars.forEach((c, i) => {
    if (c !== "@") return;
    const before = chars[i - 1];
    if (before !== undefined && (/[\p{L}\p{N}]/u.test(before) || before === ".")) return;
    const n = wanted.findIndex((want) => {
      if (want.length === 0 || chars.length <= i + want.length) return false;
      for (let k = 0; k < want.length; k++) if (chars[i + 1 + k] !== want[k]) return false;
      const after = chars[i + 1 + want.length];
      return !(after !== undefined && (/[\p{L}\p{N}]/u.test(after) || after === "_"));
    });
    if (n >= 0) out.push(n);
  });
  return out;
}

/// `text` with code taken out, so an `@name` inside a snippet calls nobody.
function withoutCode(text: string): string {
  let fenced = false;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    out.push(line.replace(/`[^`]*`/g, ""));
  }
  return out.join("\n");
}

/// The people `text` addresses with `@name`, in order of appearance, each once.
/// The same reading the backend routes by: longest name first, a word boundary
/// after it, nothing inside code, and `@all` for everyone.
export function mentionedIds(text: string, people: readonly Named[]): string[] {
  const order = [...people].sort((a, b) => [...b.name].length - [...a.name].length);
  const names = [...order.map((p) => p.name), "all", "everyone", "channel"];
  const out: string[] = [];
  for (const n of hits(withoutCode(text), names)) {
    const ids = n < order.length ? [order[n].id] : people.map((p) => p.id);
    for (const id of ids) if (!out.includes(id)) out.push(id);
  }
  return out;
}

export type Chip<T extends Named> = { agent: T; inChannel: boolean };

/// One chip per person the draft names, with whether they are in the channel.
/// Someone outside it gets a chip that says so, because the backend will not
/// bring them in.
export function addressChips<T extends Named>(text: string, everyone: readonly T[], memberIds: readonly string[]): Chip<T>[] {
  return mentionedIds(text, everyone).flatMap((id) => {
    const agent = everyone.find((a) => a.id === id);
    return agent ? [{ agent, inChannel: memberIds.includes(id) }] : [];
  });
}

/// Whether the reader has news in a channel: an agent said something after they
/// last looked. A muted channel is quiet by choice.
export function isUnread(c: Pick<Channel, "lastAgentSeq" | "readSeq" | "muted" | "archived">): boolean {
  return !c.muted && !c.archived && c.lastAgentSeq > c.readSeq;
}

/// Channels in the order the sidebar lists them: the ones with news first, then
/// by how recently anything was said, then by name.
export function sortChannels<T extends Pick<Channel, "name" | "lastTs" | "lastAgentSeq" | "readSeq" | "muted" | "archived">>(
  channels: readonly T[],
): T[] {
  return [...channels].sort(
    (a, b) =>
      Number(isUnread(b)) - Number(isUnread(a)) || b.lastTs - a.lastTs || a.name.localeCompare(b.name),
  );
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/// "Round 1 of 3 · three agents answering".
export function roundLabel(round: number, rounds: number, answering: number): string {
  const n = WORDS[answering] ?? String(answering);
  const who = answering === 1 ? "agent answering" : "agents answering";
  return `Round ${round} of ${rounds} · ${n} ${who}`;
}

/// "Today", "Yesterday", or the date.
export function dayLabel(ts: number, now: number = Date.now()): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const gap = Math.round((day(now) - day(ts)) / 86_400_000);
  if (gap === 0) return "Today";
  if (gap === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/// HH:MM in the reader's own clock.
export function clockTime(ts: number): string {
  return formatClock(new Date(ts));
}

export type FeedRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "round"; key: string; label: string }
  | { kind: "msg"; key: string; message: ChannelMessage }
  | { kind: "note"; key: string; message: ChannelMessage };

/// The transcript as rows: a day divider where the date changes, a round divider
/// where an answer opens a new round, then the messages themselves. The round
/// label counts who spoke in that run of answers, so it reads as what happened.
export function feedRows(messages: readonly ChannelMessage[], rounds: number, now: number = Date.now()): FeedRow[] {
  const rows: FeedRow[] = [];
  let day = "";
  let round = 0;
  messages.forEach((m, i) => {
    const label = dayLabel(m.ts, now);
    const stamp = new Date(m.ts).toDateString();
    if (stamp !== day) {
      day = stamp;
      rows.push({ kind: "day", key: `d${stamp}`, label });
    }
    if (m.kind === "note") {
      rows.push({ kind: "note", key: `n${m.seq}`, message: m });
      return;
    }
    if (m.round !== round) {
      round = m.round;
      if (round > 0) {
        const speakers = new Set<string>();
        for (let j = i; j < messages.length && messages[j].round === round; j++) {
          if (messages[j].kind !== "note") speakers.add(messages[j].from);
        }
        rows.push({ kind: "round", key: `r${m.seq}`, label: roundLabel(round, rounds, speakers.size) });
      }
    }
    rows.push({ kind: "msg", key: `m${m.seq}`, message: m });
  });
  return rows;
}

export const TASK_LABEL: Record<TaskStatus, string> = {
  waiting: "waiting",
  writing: "in progress",
  done: "done",
  waiting_for_you: "waiting for you",
};

/// The colour token a status dot takes.
export function taskTone(status: TaskStatus): "amber" | "green" | "ink2" | "ink3" {
  switch (status) {
    case "waiting_for_you":
      return "amber";
    case "done":
      return "green";
    case "writing":
      return "ink2";
    default:
      return "ink3";
  }
}

/// Open tasks first, newest within each group.
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.updated - a.updated);
}

export const MODES: readonly { value: Mode; title: string; hint: string }[] = [
  { value: "triage", title: "Whoever fits", hint: "hz picks who answers from their roles. Everyone when nobody fits." },
  { value: "mention", title: "Who you mention", hint: "@name picks who answers. Nobody else speaks." },
  { value: "turns", title: "Everyone, in turns", hint: "Each agent answers once per round." },
  { value: "lead", title: "The lead decides", hint: "One agent reads every message and hands it on." },
];

/// The sentence under the composer, which says how this channel answers.
export function composerHint(mode: Mode, rounds: number, leadName: string): string {
  switch (mode) {
    case "turns":
      return `Everyone answers in turns, then @mentions carry on, up to ${rounds} ${rounds === 1 ? "round" : "rounds"}.`;
    case "lead":
      return `${leadName} reads every message and hands it on, up to ${rounds} ${rounds === 1 ? "round" : "rounds"}.`;
    case "triage":
      return `The agents whose roles fit answer, or everyone, up to ${rounds} ${rounds === 1 ? "round" : "rounds"}. @name picks someone.`;
    default:
      return `Agents answer when you @mention them, up to ${rounds} ${rounds === 1 ? "round" : "rounds"}. ${leadName} leads and answers otherwise.`;
  }
}

/// A channel's Markdown export, named for the file it saves to.
export function exportName(c: Pick<Channel, "name">): string {
  return `${c.name}.md`;
}

/// The first line of a message, for a quote or a preview.
export function firstLine(text: string, max = 110): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 2).trimEnd()}…` : line;
}
