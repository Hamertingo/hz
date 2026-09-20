import type { PluginSkill, SkillRoster } from "@/types/events";

/// The kinds the roster is drawn in, in the order they are drawn.
///
/// **By where a Skill came from, because that is the question a reader has about
/// a list they did not write.** Their own Skills are the ones a switch does
/// something to; the built-ins are the ones they read. The key is the agent's own
/// word, so a kind added after this build draws as its own group.
export const SKILL_GROUP_ORDER = ["user", "builtin-agent", "builtin-global"] as const;

/// What each group is called on screen.
///
/// The agent's kinds are its own spelling and `builtin-global` is not a word a
/// reader has, so the label is ours while the key stays theirs.
const GROUP_LABELS: Record<string, string> = {
  user: "Yours",
  "builtin-agent": "This agent",
  "builtin-global": "Built-in",
};

/// Where a row with no kind of its own is filed.
const UNKNOWN_GROUP = "other";

/// A group of Skills under one heading.
export interface SkillGroup {
  key: string;
  label: string;
  skills: PluginSkill[];
}

/// The roster, grouped and ordered the way the screen draws it.
///
/// **The kinds this build knows come first, in `SKILL_GROUP_ORDER`; anything else
/// follows in the order the agent listed it.** A kind nobody here has heard of is
/// drawn rather than dropped — the same bargain `ContextComponent.label` makes:
/// the vocabulary belongs to the agent and is allowed to grow.
export function groupSkills(skills: readonly PluginSkill[]): SkillGroup[] {
  const groups = new Map<string, PluginSkill[]>();

  for (const skill of skills) {
    const key = skill.sourceKind?.trim() || UNKNOWN_GROUP;
    const held = groups.get(key);
    if (held) held.push(skill);
    else groups.set(key, [skill]);
  }

  const rank = (key: string) => {
    const at = SKILL_GROUP_ORDER.indexOf(key as (typeof SKILL_GROUP_ORDER)[number]);
    return at === -1 ? SKILL_GROUP_ORDER.length : at;
  };

  // `sort` is stable, so two unknown kinds keep the order the agent gave them.
  return [...groups.entries()]
    .sort(([left], [right]) => rank(left) - rank(right))
    .map(([key, held]) => ({
      key,
      label: GROUP_LABELS[key] ?? prettifyKind(key),
      skills: held,
    }));
}

/// The rows a query keeps.
///
/// Name, label and description together: somebody looking for the PDF Skill may
/// remember `pdf`, `PDF` or "fill and read PDFs", and matching the name alone
/// would miss the third. Same match the composer's own filters make.
export function filterSkills(skills: readonly PluginSkill[], query: string): PluginSkill[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...skills];

  return skills.filter((skill) =>
    `${skill.name} ${skill.displayName} ${skill.description}`.toLocaleLowerCase().includes(needle),
  );
}

/// How many of the roster are switched off.
///
/// The header's one number, and the reason it is worth stating: a Skill that is
/// off is one the model is not told about, which is a fact about what the agent
/// can do that nothing else on screen says.
export function countDisabled(skills: readonly PluginSkill[]): number {
  return skills.filter((skill) => !skill.enabled).length;
}

/// A kind with no label of ours, spelled the way a heading should read.
///
/// `builtin-global` never reaches here — it has a label — but a kind the agent
/// adds later does, and `Some new kind` beats a slug left as a variable name.
function prettifyKind(kind: string): string {
  const words = kind.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toLocaleUpperCase() + words.slice(1) : kind;
}

/// The roster with one Skill's switch moved.
///
/// **The row is moved rather than the list re-read.** The agent has already
/// answered what it did, so a second read would be a second question about the
/// same fact — and one that could land after another switch and undo it. A name
/// the roster no longer holds is left alone; the caller re-reads when the agent
/// says it did not recognise the row.
export function withSkillEnabled(
  roster: SkillRoster,
  name: string,
  enabled: boolean,
): SkillRoster {
  return {
    ...roster,
    skills: roster.skills.map((skill) => (skill.name === name ? { ...skill, enabled } : skill)),
  };
}
