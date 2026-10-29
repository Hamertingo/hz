import type { ChannelMessage, MessageSender, PairThread, TeamStatus } from "@/types/events";

/// The reply that says nothing is left to say (`talk.rs`'s `NO_REPLY`). It is
/// never drawn: not as an answer, not in the sidebar's last line.
export function isNoReply(text: string | null | undefined): boolean {
  if (text == null) return false;
  const t = text.trim().replace(/^[`*.\s]+|[`*.\s]+$/g, "");
  return t.length > 0 && t.toUpperCase().startsWith("NO_REPLY");
}

/// What `answer_prompt` in `talk.rs` wraps a teammate's answer in, rebuilt from
/// the sender the event names. Built, never parsed: a name holding a bracket can
/// only fail by matching nothing. Change both sides together.
export function answerPrefix(from: MessageSender): string {
  return `[${from.title} answered in your thread]\n\n`;
}

export function answerSuffix(from: MessageSender): string {
  return `\n\n(Tell the person in a line or two what came back, then carry on. If it needs nothing from you, answer NO_REPLY. To write back to ${from.title}, use team_message.)`;
}

/// The teammate's answer alone, or `null` when this prompt is not one.
export function answerBody(text: string, from: MessageSender | null | undefined): string | null {
  if (!from) return null;
  const prefix = answerPrefix(from);
  if (!text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length);
  const suffix = answerSuffix(from);
  return rest.endsWith(suffix) ? rest.slice(0, -suffix.length) : rest;
}

/// Whether a thread message is one `agentId`'s own chat shows nowhere else: its
/// own chat draws a message it sent from there (the "Sent a message" row) and an
/// answer that woke it there (the "answered" line), so only the rest count.
export function counts(m: ChannelMessage, agentId: string): boolean {
  if (m.kind !== "message") return false;
  return m.from === agentId ? m.fromChat !== true : m.toChat !== true;
}

/// One "N messages with X" line in an agent's chat.
export type ThreadLine = { channelId: string; other: string; count: number; latest: ChannelMessage };

/// The thread lines that fall between two points of an agent's chat (`from`
/// exclusive, `to` inclusive, unix ms): one per thread, carrying how many of its
/// messages landed there and the newest. Consecutive thread messages are one
/// line until something is said in the chat itself, which is what the window is.
export function threadLines(pairs: readonly PairThread[], agentId: string, from: number, to: number): ThreadLine[] {
  const out: ThreadLine[] = [];
  for (const p of pairs) {
    const inside = p.messages.filter((m) => m.ts > from && m.ts <= to && counts(m, agentId));
    if (inside.length === 0) continue;
    out.push({ channelId: p.channelId, other: p.other, count: inside.length, latest: inside[inside.length - 1] });
  }
  return out.sort((a, b) => a.latest.ts - b.latest.ts);
}

/// What an agent is doing for its team, said where its own chat is idle:
/// answering a teammate in a thread first, else waiting on one.
export function teamActivity(
  status: readonly TeamStatus[],
  agentId: string,
): { activity: "workingFor" | "waitingFor"; who: string[] } | null {
  const mine = status.find((s) => s.agentId === agentId);
  if (!mine) return null;
  if (mine.workingFor.length > 0) return { activity: "workingFor", who: mine.workingFor };
  if (mine.waitingFor.length > 0) return { activity: "waitingFor", who: mine.waitingFor };
  return null;
}

const WORDS = {
  pt: {
    sent: "Enviou mensagem para",
    sending: "Enviando para",
    failed: "Não deu para enviar para",
    asked: "Perguntou a",
    answer: "Resposta de",
    message: "Mensagem de",
    with: (n: number) => `${n} ${n === 1 ? "mensagem" : "mensagens"} com`,
    and: "e",
    readOnly: "Somente leitura",
    back: "Voltar",
    empty: "Eles ainda não conversaram.",
  },
  es: {
    sent: "Envió un mensaje a",
    sending: "Enviando a",
    failed: "No se pudo enviar a",
    asked: "Preguntó a",
    answer: "Respuesta de",
    message: "Mensaje de",
    with: (n: number) => `${n} ${n === 1 ? "mensaje" : "mensajes"} con`,
    and: "y",
    readOnly: "Solo lectura",
    back: "Volver",
    empty: "Todavía no han hablado.",
  },
  en: {
    sent: "Sent a message to",
    sending: "Sending to",
    failed: "Couldn't send to",
    asked: "Asked",
    answer: "Answer from",
    message: "Message from",
    with: (n: number) => `${n} ${n === 1 ? "message" : "messages"} with`,
    and: "and",
    readOnly: "Read only",
    back: "Back",
    empty: "They have not written to each other yet.",
  },
};

/// The words of the team-talk rows and the thread view, in the reader's language.
export function talkWords(language: string | null | undefined) {
  const l = (language ?? "").toLowerCase();
  return l.startsWith("portugu") ? WORDS.pt : l.startsWith("espa") ? WORDS.es : WORDS.en;
}
