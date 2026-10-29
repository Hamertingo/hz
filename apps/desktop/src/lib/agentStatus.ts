import type { AgentEvent } from "@/types/events";

/// What an agent is doing right now, as one word the status line turns into a sentence.
export type Activity =
  | "reflecting"
  | "thinking"
  | "writing"
  | "computer"
  | "mac"
  | "reading"
  | "code"
  | "web"
  | "searching"
  | "planning"
  | "helper"
  | "asking"
  | "working"
  /// Answering a teammate in their thread; the name comes in as `who`.
  | "workingFor"
  /// Wrote to a teammate and has no answer yet.
  | "waitingFor";

/// What the stream says about the turn before any event commits: nothing yet, reasoning, or reply text.
export type Hint = "waiting" | "thinking" | "writing" | undefined;

/// A tool the agent runs inside its own computer (HyzeVM's tools, however the CLI prefixes them).
function onItsComputer(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("hyzevm") || n.startsWith("mcp__computer__") || /^(mcp__[^_]+__)?(machine|desktop|browser|takeover|checkpoint)_/.test(n) || /(^|__)request_takeover$/.test(n);
}

/// The activity a tool call stands for, by its name and kind.
export function ofTool(name: string, toolType: string): Activity {
  if (onItsComputer(name)) return "computer";
  if (name.toLowerCase().includes("todo")) return "planning";
  switch (toolType) {
    case "shell":
      return "mac";
    case "file_read":
      return "reading";
    case "file_edit":
      return "code";
    case "search":
      return "searching";
    case "web":
      return "web";
    case "subagent_spawn":
      return "helper";
    default:
      return "working";
  }
}

/// Reads the turn so far: a tool still running names the activity; otherwise the stream's hint; otherwise the
/// agent is between steps (thinking) or has not started (reflecting).
export function activityOf(events: readonly AgentEvent[], hint: Hint, finished: (callId: string) => boolean = () => false): Activity {
  if (hint === "thinking") return "thinking";
  const done = new Set<string>();
  for (const e of events) if (e.payload.type === "tool_call_completed") done.add(e.payload.callId);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const p = events[i].payload;
    if (p.type === "tool_call_started") {
      if (!done.has(p.callId) && !finished(p.callId)) return ofTool(p.name, p.toolType);
      break;
    }
    if (p.type === "reasoning") return hint === "writing" ? "writing" : "thinking";
    if (p.type === "assistant_text") break;
  }
  if (hint === "writing") return "writing";
  return events.length > 0 ? "thinking" : "reflecting";
}

const VERBS: Record<"pt" | "en" | "es", Record<Activity, string>> = {
  pt: {
    reflecting: "refletindo",
    thinking: "pensando",
    writing: "escrevendo",
    computer: "usando o computador dele",
    mac: "usando o seu Mac",
    reading: "lendo arquivos",
    code: "escrevendo código",
    web: "pesquisando na web",
    searching: "procurando no projeto",
    planning: "planejando",
    helper: "chamando um ajudante",
    asking: "esperando você",
    working: "trabalhando",
    workingFor: "trabalhando para {who}",
    waitingFor: "esperando {who}",
  },
  es: {
    reflecting: "reflexionando",
    thinking: "pensando",
    writing: "escribiendo",
    computer: "usando su computadora",
    mac: "usando tu Mac",
    reading: "leyendo archivos",
    code: "escribiendo código",
    web: "buscando en la web",
    searching: "buscando en el proyecto",
    planning: "planificando",
    helper: "llamando a un ayudante",
    asking: "esperándote",
    working: "trabajando",
    workingFor: "trabajando para {who}",
    waitingFor: "esperando a {who}",
  },
  en: {
    reflecting: "is reflecting",
    thinking: "is thinking",
    writing: "is writing",
    computer: "is using its computer",
    mac: "is using your Mac",
    reading: "is reading files",
    code: "is writing code",
    web: "is searching the web",
    searching: "is searching the project",
    planning: "is planning",
    helper: "is calling a helper",
    asking: "is waiting for you",
    working: "is working",
    workingFor: "is working for {who}",
    waitingFor: "is waiting for {who}",
  },
};

/// The words after the agent's name, in the reader's language (the one they picked in Settings → Profile).
/// `who` names the teammate for `workingFor` and `waitingFor`.
export function verbFor(activity: Activity, language: string | null | undefined, who = ""): string {
  const l = (language ?? "").toLowerCase();
  const table = l.startsWith("portugu") ? VERBS.pt : l.startsWith("espa") ? VERBS.es : VERBS.en;
  return table[activity].replace("{who}", who);
}

/// The same words without the subject, for places that already show the name (the sidebar row, the header):
/// "pensando", "thinking". `capital` starts it with a capital letter.
export function stateFor(activity: Activity, language: string | null | undefined, capital = false, who = ""): string {
  const v = verbFor(activity, language, who).replace(/^(is|está) /, "");
  return capital ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}
