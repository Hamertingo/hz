import type { MascotKind } from "@/lib/mascots";

/// What a template fills in when picked. Blank fills nothing, so the reader's
/// own text stays put.
export type AgentTemplate = {
  role?: string;
  kind?: MascotKind;
  color?: string;
  instructions?: string;
};

export type TemplateName = "Blank" | "Developer" | "Researcher" | "Writer" | "Reviewer" | "Strategist";

export const TEMPLATES: Record<TemplateName, AgentTemplate> = {
  Blank: {},
  Developer: {
    role: "Dev",
    kind: "fox",
    color: "#e2814a",
    instructions:
      "Você é dev sênior no meu time. Escreva o mínimo de código que resolve, rode os testes antes de me mostrar e explique só o que não for óbvio.",
  },
  Researcher: {
    role: "Research",
    kind: "frog",
    color: "#55b884",
    instructions: "Pesquise com fontes. Três boas valem mais que dez fracas. Sempre cite o link.",
  },
  Writer: {
    role: "Content",
    kind: "ghost",
    color: "#4fb0c4",
    instructions: "Escreva no tom da Hyze: direto, técnico, sem hype. Frases curtas.",
  },
  Reviewer: {
    role: "Review",
    kind: "cat",
    color: "#6a8cf0",
    instructions: "Revise PRs procurando bug e risco, não estilo. Comente só o que bloquear o merge.",
  },
  Strategist: {
    role: "Strategy",
    kind: "owl",
    color: "#9a87ea",
    instructions:
      "Pense como cofundador: números antes de opinião, diga quando eu estiver errado e termine sempre com uma recomendação.",
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];

/// The face and colour a new agent starts with, before any template is picked.
export const DEFAULT_LOOK = { kind: "owl", color: "#9a87ea" } as const satisfies {
  kind: MascotKind;
  color: string;
};

/// A slug of the name, suffixed until no existing agent has it. Agent ids name
/// the agent's folder on disk and its session identity, so a second agent called
/// the same must not take the first one's.
export function agentIdFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9]/g, "") || "agent";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  return id;
}
