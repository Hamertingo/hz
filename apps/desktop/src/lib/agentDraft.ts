import type { Look, ShapeName } from "@/lib/face";
import type { MascotKind } from "@/lib/mascots";

/// A ready-made agent: the face, role, engine and permission it starts with, and the instructions it is given.
export type AgentTemplate = {
  name: string;
  description: string;
  role: string;
  shape: ShapeName;
  color: string;
  look: Required<Look>;
  cli: "Claude" | "Codex" | "OpenCode";
  permission: "manual" | "plan" | "auto";
  instructions: string;
};

/// The eight the new-agent dialog offers under Ready-made, from design/simple/modals.js. Colours are the
/// nearest of the app's picker colours, so a template's face is one the picker can also make.
export const TEMPLATES: readonly AgentTemplate[] = [
  {
    name: "Dev",
    description: "Writes code, runs tests, opens pull requests",
    role: "Developer",
    shape: "squircle",
    color: "#e2814a",
    look: { eyes: "dot", mouth: "grin", acc: "headphones", pat: "none" },
    cli: "Claude",
    permission: "auto",
    instructions: "You write and test code. Open a pull request, never push to main.",
  },
  {
    name: "Marketer",
    description: "Drafts posts and campaigns, asks before publishing",
    role: "Marketing",
    shape: "diamond",
    color: "#df6f86",
    look: { eyes: "wide", mouth: "smile", acc: "bow", pat: "cheeks" },
    cli: "Codex",
    permission: "manual",
    instructions: "You draft marketing copy. Never publish without approval.",
  },
  {
    name: "Scout",
    description: "Reads sources and writes short briefs",
    role: "Research",
    shape: "cloud",
    color: "#55b884",
    look: { eyes: "round", mouth: "o", acc: "sprout", pat: "spots" },
    cli: "OpenCode",
    permission: "plan",
    instructions: "You research and cite sources. You never change files.",
  },
  {
    name: "Helper",
    description: "Answers customer questions from your docs",
    role: "Support",
    shape: "drop",
    color: "#4fb0c4",
    look: { eyes: "happy", mouth: "smile", acc: "cap", pat: "none" },
    cli: "Claude",
    permission: "manual",
    instructions: "You answer support questions using the docs only.",
  },
  {
    name: "Ops",
    description: "Watches pools, alerts and costs",
    role: "Infra",
    shape: "hex",
    color: "#9198a8",
    look: { eyes: "visor", mouth: "flat", acc: "antenna", pat: "stripes" },
    cli: "Codex",
    permission: "auto",
    instructions: "You watch infrastructure and report anomalies first.",
  },
  {
    name: "Quill",
    description: "Long-form drafts in your voice",
    role: "Writer",
    shape: "ghost",
    color: "#9a87ea",
    look: { eyes: "round", mouth: "smile", acc: "glasses", pat: "none" },
    cli: "Claude",
    permission: "auto",
    instructions: "You write long-form drafts in the founder's voice.",
  },
  {
    name: "Guard",
    description: "Scans for CVEs and risky changes",
    role: "Security",
    shape: "cat",
    color: "#6a8cf0",
    look: { eyes: "sleepy", mouth: "cat", acc: "horns", pat: "belly" },
    cli: "Claude",
    permission: "manual",
    instructions: "You review security risks and report them by severity.",
  },
  {
    name: "Pal",
    description: "Reminders, calendar and life admin",
    role: "Assistant",
    shape: "star",
    color: "#e2a440",
    look: { eyes: "dot", mouth: "cat", acc: "crown", pat: "cheeks" },
    cli: "Claude",
    permission: "plan",
    instructions: "You keep track of reminders and dates.",
  },
];

export type TemplateName = (typeof TEMPLATES)[number]["name"];

export const TEMPLATE_NAMES = TEMPLATES.map((t) => t.name);

/// The face and colour a new agent starts with, before any template is picked.
export const DEFAULT_LOOK: {
  kind: MascotKind;
  color: string;
  shape: ShapeName;
  look: Required<Look>;
} = {
  kind: "owl",
  color: "#9a87ea",
  shape: "circle",
  look: { eyes: "round", mouth: "smile", acc: "none", pat: "none" },
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
