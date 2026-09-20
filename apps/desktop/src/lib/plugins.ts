import type { AgentPick } from "@/lib/agents";
import type { McpPick } from "@/lib/mcp";
import type { PluginSkill } from "@/types/events";

/// What the Plugins page is listing, and what its pane is showing with it.
///
/// **One value, because the two have to agree.** The pane draws the thing its own
/// section lists — a Skill, a server, an Agent — so a section and a pick held
/// apart are two states that must be kept in step, and a pane left on a Skill
/// while the servers are listed is a pane describing something that is not on the
/// page. Same shape as the page flags this app already paid for once.
///
/// **Three sections, and the third is a different kind of thing again.** Skills
/// are what the agent already knows how to do; MCP servers are tools somebody
/// else wrote and this machine was told about; Agents are the identities a
/// delegated task runs as. Each has its own pick type because each row opens
/// something different.
export type PluginsTab =
  | { section: "skills"; skill: PluginSkill | null }
  | { section: "mcp"; pick: McpPick }
  | { section: "agents"; pick: AgentPick };

export type PluginsSection = PluginsTab["section"];

/// The page with a section chosen and nothing picked.
///
/// The pick is dropped deliberately: switching sections is a change of subject,
/// and carrying the old one across only makes sense if the pane could show it —
/// which is exactly what the invariant above forbids.
export function sectionTab(section: PluginsSection): PluginsTab {
  if (section === "skills") return { section: "skills", skill: null };
  if (section === "mcp") return { section: "mcp", pick: null };
  return { section: "agents", pick: null };
}

/// What the MCP pane is showing, where the MCP section is the one up.
export function mcpPickOf(tab: PluginsTab): McpPick {
  return tab.section === "mcp" ? tab.pick : null;
}

/// The Skill the list should draw as picked, where the Skills section is up.
export function pickedSkillOf(tab: PluginsTab): PluginSkill | null {
  return tab.section === "skills" ? tab.skill : null;
}

/// What the Agents pane is showing, where the Agents section is the one up.
export function agentPickOf(tab: PluginsTab): AgentPick {
  return tab.section === "agents" ? tab.pick : null;
}

/// Whether the pane is showing anything at all.
///
/// One question with one answer, because the three sections hold different things
/// — which is exactly why it lives here rather than being asked of `tab.skill` at
/// one site and `tab.pick` at another, where the third one would one day be
/// forgotten.
export function hasPick(tab: PluginsTab): boolean {
  switch (tab.section) {
    case "skills":
      return tab.skill !== null;
    case "mcp":
      return tab.pick !== null;
    case "agents":
      return tab.pick !== null;
  }
}
