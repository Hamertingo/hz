import {
  ChevronDown,
  ChevronUp,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

import AgentAvatar from "@/components/plugins/AgentAvatar";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { usePluginAgents } from "@/hooks/usePluginAgents";
import { usePluginMcp, type McpTestState } from "@/hooks/usePluginMcp";
import { usePluginSkills, useSkillText } from "@/hooks/usePluginSkills";
import { filterAgents, groupAgents, type AgentPick } from "@/lib/agents";
import {
  agentPickOf,
  mcpPickOf,
  pickedSkillOf,
  sectionTab,
  type PluginsTab,
} from "@/lib/plugins";
import { countDisabled, filterSkills, groupSkills } from "@/lib/skills";
import { describeTest, serverEndpoint, type McpPick } from "@/lib/mcp";
import { cn } from "@/lib/utils";
import type { PluginAgent, PluginMcpServer, PluginSkill } from "@/types/events";

/// What the agent can be told to do, in one column.
///
/// **A page, not a session** — the same shape the issues and pull-request screens
/// take: a sidebar row whose detail lives in the right pane, no composer. What it
/// shows belongs to the *machine* rather than to any one conversation, so a
/// session-scoped surface would be the wrong address for it.
///
/// **Three sections, because they are three different kinds of thing.** Skills are
/// what the agent already knows how to do; MCP servers are tools somebody else
/// wrote and this machine was told about; Agents are the identities a delegated
/// task runs as. All three are managed from here and none is a session's, which is
/// the whole of what they share.
///
/// **Every list here is the management one.** The agent has two of each, and the
/// other pair is what a *session* can reach — where a Skill or a server that is
/// switched off is simply absent. A screen with switches in it cannot be built on
/// those: switching something off would take away its own row, and the way back
/// with it.
export default function PluginsView({
  active,
  tab,
  onTab,
  onClose,
  refreshRef,
}: {
  active: boolean;
  /// Which section is up, and what the pane is showing with it — one value, see
  /// [`PluginsTab`].
  tab: PluginsTab;
  onTab: (tab: PluginsTab) => void;
  onClose: () => void;
  /// The page's own refresh, handed up so ⌘R reaches it — the handle the issues and
  /// pull-request pages hand up, for the same reason: the page owns the read and the
  /// rest of the app only presses a button.
  refreshRef?: MutableRefObject<(() => void) | null>;
}) {
  // All three are mounted and only one reads: each is handed `active` for its own
  // section, so switching sections costs a read the first time and a cache after
  // that. Hooks cannot be conditional, and they would not need to be — this is one
  // page with three halves, not three pages.
  const skills = usePluginSkills(active && tab.section === "skills");
  const mcp = usePluginMcp(active && tab.section === "mcp");
  const agents = usePluginAgents(active && tab.section === "agents");
  const [query, setQuery] = useState("");

  const section = tab.section;

  const refresh = useCallback(() => {
    if (section === "skills") skills.refresh();
    else if (section === "mcp") mcp.refresh();
    else agents.refresh();
  }, [section, skills, mcp, agents]);

  if (refreshRef) refreshRef.current = refresh;

  /// Switching sections, which is also what clears the pane.
  ///
  /// One call rather than two, because the section and the pick are one value: a
  /// Skill left in the pane under the servers is a pane describing something that
  /// is not on the page.
  const setSection = (next: PluginsTab["section"]) => {
    if (next === section) return;
    onTab(sectionTab(next));
    // The box filters whichever list is up, so a phrase typed for one is not a
    // filter for the other.
    setQuery("");
  };

  const roster = skills.roster?.skills ?? [];
  const groups = useMemo(
    () => groupSkills(filterSkills(roster, query)),
    [roster, query],
  );
  const agentGroups = useMemo(
    () => groupAgents(filterAgents(agents.agents ?? [], query)),
    [agents.agents, query],
  );
  const servers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const rows = mcp.servers ?? [];
    if (!needle) return rows;
    return rows.filter((server) =>
      `${server.name} ${server.description ?? ""} ${server.endpoint ?? ""}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [mcp.servers, query]);

  // Nothing read yet and nothing to paint: the placeholders. Once a list is up it
  // stays up while the next read lands, so a refresh does not blink it away.
  const loading =
    section === "skills" ? skills.loading : section === "mcp" ? mcp.loading : agents.loading;
  const firstRead =
    section === "skills"
      ? loading && !skills.roster
      : section === "mcp"
        ? loading && !mcp.servers
        : loading && !agents.agents;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-ui font-medium">Plugins</h2>

          {/* Three words rather than a menu: there are three sections and the
              reader needs to know all of them exist. The counts are here rather
              than beside each list because this is the only row on screen under
              all three. */}
          <div className="flex items-center gap-0.5">
            <SectionButton
              active={section === "skills"}
              label="Skills"
              count={roster.length}
              onClick={() => setSection("skills")}
            />
            <SectionButton
              active={section === "mcp"}
              label="MCP servers"
              count={mcp.servers?.length ?? 0}
              onClick={() => setSection("mcp")}
            />
            <SectionButton
              active={section === "agents"}
              label="Agents"
              count={agents.agents?.length ?? 0}
              onClick={() => setSection("agents")}
            />
          </div>

          <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto cursor-pointer">
            Close
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex h-7 min-w-40 flex-1 items-center gap-1.5 rounded-md border border-border px-2 text-ui focus-within:border-accent">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              // Matched here rather than asked for: both lists are one read and a
              // few dozen rows, so a round trip per keystroke would be the agent's
              // child answering a question this page can answer itself.
              placeholder={
                section === "skills"
                  ? "Filter skills"
                  : section === "mcp"
                    ? "Filter servers"
                    : "Filter agents"
              }
              spellCheck={false}
              onChange={(e) => setQuery(e.currentTarget.value)}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
          </label>

          {section === "mcp" && (
            <Button
              variant="outline"
              size="sm"
              // The one way a server gets written down, and it opens the pane rather
              // than a dialog: the form is the same one a row opens, so there is one
              // place the fields live.
              onClick={() => onTab({ section: "mcp", pick: { mode: "new" } })}
              className="cursor-pointer gap-1.5"
            >
              <Plus className="size-3.5" />
              Add server
            </Button>
          )}

          {section === "agents" && (
            <Button
              variant="outline"
              size="sm"
              // The one way an Agent gets written down. Same bargain as the server
              // above: the form is the row's own, so there is one place the fields
              // live.
              onClick={() => onTab({ section: "agents", pick: { mode: "new" } })}
              className="cursor-pointer gap-1.5"
            >
              <Plus className="size-3.5" />
              Create agent
            </Button>
          )}

          <Button
            variant="outline"
            size="icon-sm"
            aria-label={
              section === "skills"
                ? "Re-read the Skill roster"
                : section === "mcp"
                  ? "Re-read the MCP servers"
                  : "Re-read the agents"
            }
            onClick={refresh}
            disabled={loading}
            className="cursor-pointer text-muted-foreground"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {section === "skills" ? (
          <SkillsSection
            skills={skills}
            groups={groups}
            query={query}
            firstRead={firstRead}
            picked={pickedSkillOf(tab)}
            onPick={(skill) => onTab({ section: "skills", skill })}
          />
        ) : section === "mcp" ? (
          <McpSection
            mcp={mcp}
            servers={servers}
            query={query}
            firstRead={firstRead}
            picked={mcpPickOf(tab)}
            active={active && section === "mcp"}
            onPick={(pick: McpPick) => onTab({ section: "mcp", pick })}
          />
        ) : (
          <AgentsSection
            agents={agents}
            groups={agentGroups}
            query={query}
            firstRead={firstRead}
            picked={agentPickOf(tab)}
            onPick={(pick: AgentPick) => onTab({ section: "agents", pick })}
          />
        )}
      </div>
    </div>
  );
}

/// One word of the section switch, with the count of what is behind it.
///
/// The count is here and nowhere else under both sections: a list that is empty for
/// a reason, or longer than it looks, says so on the control that would show it.
function SectionButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "cursor-pointer gap-1.5",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      <span className="text-xs tabular-nums opacity-70">{count}</span>
    </Button>
  );
}

/// The agents this machine holds, in their groups.
///
/// **One row per definition and no switch.** A Skill is something the agent can be
/// told not to use; an Agent is not — it does nothing until a task names it, so a
/// switch here would be a control over nothing at all.
function AgentsSection({
  agents,
  groups,
  query,
  firstRead,
  picked,
  onPick,
}: {
  agents: ReturnType<typeof usePluginAgents>;
  groups: ReturnType<typeof groupAgents>;
  query: string;
  firstRead: boolean;
  picked: AgentPick;
  onPick: (pick: AgentPick) => void;
}) {
  const roster = agents.agents ?? [];
  const pickedName = picked?.mode === "agent" ? picked.name : null;

  return (
    <>
      {agents.error && <Problem detail={agents.error} />}

      {firstRead && <PlaceholderRows />}

      {!agents.error && !firstRead && roster.length === 0 && (
        <Filler>
          {agents.loading
            ? "Reading the agent's Agents…"
            : "The agent names no agents. It ships three, so this is a read that came back empty."}
        </Filler>
      )}

      {!firstRead && roster.length > 0 && groups.length === 0 && (
        <Filler>Nothing matches “{query}”.</Filler>
      )}

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-0.5">
          {/* No outer `groups.length > 1` guard, unlike the Skill roster: there
              are two kinds here by construction, and "Built-in" over three rows is
              the answer to "did I write these?" rather than a heading nobody
              asked for. */}
          <h3 className="flex items-center gap-1.5 px-3 pt-1 pb-0.5 text-ui text-muted-foreground">
            <span className="font-medium text-foreground">{group.label}</span>
            <span className="tabular-nums">{group.agents.length}</span>
          </h3>
          {group.agents.map((agent) => (
            <AgentRow
              key={agent.name}
              agent={agent}
              selected={pickedName === agent.name}
              onSelect={() => onPick({ mode: "agent", name: agent.name })}
            />
          ))}
        </section>
      ))}

      {/* The way in, drawn under the list as well as in the toolbar: the list is
          where a reader looking for an Agent to edit is already looking, and the
          button that makes one belongs where the rows are. */}
      {!firstRead && groups.length > 0 && (
        <button
          type="button"
          onClick={() => onPick({ mode: "new" })}
          className={cn(
            "mt-1 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-ui transition-colors",
            picked?.mode === "new"
              ? "bg-sidebar-accent"
              : "text-muted-foreground hover:bg-sidebar-accent/50",
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed border-border">
            <Plus className="size-3.5" />
          </span>
          Create agent
        </button>
      )}
    </>
  );
}

/// One Agent: its face, what it is called, and what it is for.
///
/// The row says what the agent *is*. **It says nothing about what it is doing** —
/// a definition has no state, and a liveness mark here would be a claim about a
/// session this list cannot see. That is the Subagents tab's question.
function AgentRow({
  agent,
  selected,
  onSelect,
}: {
  agent: PluginAgent;
  selected: boolean;
  onSelect: () => void;
}) {
  // The description where the agent has one, and its own name otherwise — the
  // store's slug is what a `task` call types, so it is worth the line when the
  // label above it differs.
  const subtitle =
    agent.description?.trim() || (agent.name !== agent.displayName ? agent.name : null);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-ui transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
        selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
      )}
    >
      <AgentAvatar agent={agent} size={28} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="min-w-0 truncate font-medium">{agent.displayName}</span>
        {subtitle && (
          <span className="min-w-0 truncate text-xs text-muted-foreground/70">{subtitle}</span>
        )}
      </span>
    </div>
  );
}

/// The roster, in its groups.
function SkillsSection({
  skills,
  groups,
  query,
  firstRead,
  picked,
  onPick,
}: {
  skills: ReturnType<typeof usePluginSkills>;
  groups: ReturnType<typeof groupSkills>;
  query: string;
  firstRead: boolean;
  picked: PluginSkill | null;
  onPick: (skill: PluginSkill) => void;
}) {
  const roster = skills.roster?.skills ?? [];
  const disabled = countDisabled(roster);

  return (
    <>
      {skills.error && <Problem detail={skills.error} />}

      {firstRead && <PlaceholderRows />}

      {!skills.error && !firstRead && roster.length === 0 && (
        <Filler>
          {skills.loading
            ? "Reading the agent's Skills…"
            : "The agent publishes no Skills on this machine."}
        </Filler>
      )}

      {!firstRead && roster.length > 0 && groups.length === 0 && (
        <Filler>Nothing matches “{query}”.</Filler>
      )}

      {groups.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-0.5">
              {/* A heading where the list is more than one run: over a single group
                  it answers a question nobody asked, and the roster of a machine
                  that has only its built-ins would open on "Built-in" over every
                  row it has. */}
              {groups.length > 1 && (
                <h3 className="flex items-center gap-1.5 px-3 pt-1 pb-0.5 text-ui text-muted-foreground">
                  <span className="font-medium text-foreground">{group.label}</span>
                  <span className="tabular-nums">{group.skills.length}</span>
                </h3>
              )}
              {group.skills.map((skill) => (
                <SkillRow
                  key={skill.locationUri ?? skill.name}
                  skill={skill}
                  selected={picked?.name === skill.name}
                  switching={skills.switching === skill.name}
                  onSelect={() => onPick(skill)}
                  onToggle={(enabled) => void skills.setEnabled(skill, enabled)}
                />
              ))}
            </section>
          ))}
        </div>
      )}

      {/* Stated once under the list rather than per row: a Skill that is off is one
          the model is not told about, which is a fact about what the agent can do
          that no row on its own says. */}
      {disabled > 0 && groups.length > 0 && (
        <p className="px-3 pt-3 text-ui text-muted-foreground/70">
          {disabled} switched off — the agent is not told about {disabled === 1 ? "it" : "them"}.
        </p>
      )}
    </>
  );
}

/// The servers this machine has written down, and what each one answers.
///
/// **Opening this tab is what dials them.** Whether a server works is not something
/// a listing can describe — it is a connection — so the list asks, and each row
/// draws the answer as it lands: a mark, how much the server offers, and the tools
/// themselves under the row. That is the whole reason the answer carries the tool
/// list rather than only a count.
///
/// A pass asks **once per server**: entering the tab, leaving it and coming back
/// must not dial the machine's servers again, and Refresh is the reader saying they
/// want today's answer rather than the one from a minute ago.
function McpSection({
  mcp,
  servers,
  query,
  firstRead,
  picked,
  active,
  onPick,
}: {
  mcp: ReturnType<typeof usePluginMcp>;
  servers: PluginMcpServer[];
  query: string;
  firstRead: boolean;
  picked: McpPick;
  active: boolean;
  onPick: (pick: McpPick) => void;
}) {
  /// Which rows are showing their tools. Held here rather than per row so one place
  /// owns it — and so it goes with the section when the reader switches away.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /// The row whose delete has been pressed once, by name. One id rather than a flag
  /// per row: two rows asking at once is two questions from one press.
  const [confirming, setConfirming] = useState<string | null>(null);

  const all = mcp.servers ?? [];
  const disabled = all.filter((server) => !server.enabled).length;
  const pickedName = picked?.mode === "server" ? picked.name : null;

  // **On entering, and only for the servers that have not answered.** `version` is
  // what makes this run as each answer lands rather than on every render, and the
  // filter is what makes a second entry a no-op — the answers are the memory.
  useEffect(() => {
    if (!active || !mcp.servers) return;
    const pending = mcp.servers
      .filter((server) => server.enabled && mcp.testOf(server.name) === undefined)
      .map((server) => server.name);
    if (pending.length > 0) void mcp.testServers(pending);
  }, [active, mcp.servers, mcp.version, mcp.testServers, mcp.testOf]);

  const toggleExpanded = (name: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <>
      {mcp.error && <Problem detail={mcp.error} />}

      {firstRead && <PlaceholderRows />}

      {!mcp.error && !firstRead && all.length === 0 && (
        <Filler>
          {mcp.loading
            ? "Reading the agent's MCP servers…"
            : "No MCP servers yet. Add one, and the agent can use its tools."}
        </Filler>
      )}

      {!firstRead && all.length > 0 && servers.length === 0 && (
        <Filler>Nothing matches “{query}”.</Filler>
      )}

      {servers.length > 0 && (
        <div className="flex flex-col gap-1">
          {servers.map((server) => (
            <McpRow
              key={server.name}
              server={server}
              test={mcp.testOf(server.name)}
              expanded={expanded.has(server.name)}
              confirming={confirming === server.name}
              selected={pickedName === server.name}
              switching={mcp.switching === server.name}
              onSelect={() => onPick({ mode: "server", name: server.name })}
              onToggleExpanded={() => toggleExpanded(server.name)}
              onToggle={(enabled) => void mcp.setEnabled(server, enabled)}
              onAskDelete={() => setConfirming(server.name)}
              onBlurDelete={() => setConfirming(null)}
              onDelete={() => {
                setConfirming(null);
                void mcp.deleteServer(server.name).then((deleted) => {
                  // The pane may be the form of the row that just went.
                  if (deleted && pickedName === server.name) onPick(null);
                });
              }}
            />
          ))}
        </div>
      )}

      {disabled > 0 && servers.length > 0 && (
        <p className="px-3 pt-3 text-ui text-muted-foreground/70">
          {disabled} switched off — the agent is not offered {disabled === 1 ? "it" : "them"}.
        </p>
      )}
    </>
  );
}

/// One Skill's own text, drawn in the right pane.
///
/// **The document as it is, not rendered as markdown.** A Skill body is a file with
/// a YAML head, and the reader is here to see what the agent was told — so the head
/// stays, nothing is reinterpreted, and what is copied out of here is what is on
/// disk.
export function SkillDetail({ skill }: { skill: PluginSkill | null }) {
  const { text, loading, error, missing } = useSkillText(skill);

  if (!skill) {
    return <Filler>Choose a Skill to read what it tells the agent to do.</Filler>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-ui font-medium">{skill.displayName}</h3>
          {/* The state is stated rather than implied by the switch back on the
              list: this pane can be read with the list scrolled away from the row
              it belongs to. */}
          <span
            className={cn(
              "shrink-0 rounded-full border border-border px-1.5 py-px text-ui",
              skill.enabled ? "text-muted-foreground" : "text-muted-foreground/70",
            )}
          >
            {skill.enabled ? "On" : "Off"}
          </span>
        </div>
        {skill.description && (
          <p className="text-balance text-ui text-muted-foreground">{skill.description}</p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && text === null && (
          <p className="text-ui text-muted-foreground">Reading the Skill…</p>
        )}

        {error && <Problem detail={error} />}

        {!error && missing && (
          <p className="text-balance text-ui text-muted-foreground">
            The agent no longer has this Skill — it was removed or renamed since this list was read.
          </p>
        )}

        {!error && !missing && text !== null && (
          <pre className="font-mono text-[length:var(--fs-code)] leading-relaxed whitespace-pre-wrap break-words">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}

/// A read with nothing behind it yet.
///
/// Bars built from the real row's own boxes, so the rows land where the wait
/// already took rather than pushing the screen down when they arrive. In `em`
/// against `text-ui`, so a reader who raised the interface size gets placeholders
/// that grew with it.
function PlaceholderRows() {
  // Ragged, so the block reads as a list of things rather than as a table.
  const widths = ["w-40", "w-28", "w-36", "w-24", "w-32", "w-44"];

  return (
    <div aria-hidden className="flex flex-col gap-0.5">
      {widths.map((width) => (
        <div
          key={width}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-ui"
        >
          <span className="flex flex-col gap-1">
            <span className={cn("h-[1.4em] animate-pulse rounded bg-muted-foreground/20", width)} />
            <span className="h-[1.3em] w-56 animate-pulse rounded bg-muted-foreground/10" />
          </span>
          <span className="mt-0.5 h-4 w-7 shrink-0 animate-pulse rounded-full bg-muted-foreground/20" />
        </div>
      ))}
    </div>
  );
}

/// One Skill: what it is, and the switch that moves it.
///
/// **Two controls in one row, and the row is not a button.** Opening a Skill and
/// switching one are different acts — the first reads, the second changes what the
/// agent is told — so the row is a `div` wearing `role="button"` with the switch
/// inside it, which is the shape `PrsView`'s own rows take. A real `button` here
/// would nest a control inside a control: invalid markup whose keyboard behaviour
/// assistive tech is free to collapse.
function SkillRow({
  skill,
  selected,
  switching,
  onSelect,
  onToggle,
}: {
  skill: PluginSkill;
  selected: boolean;
  switching: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Row selected={selected}>
      <RowBody
        selected={selected}
        onSelect={onSelect}
        title={skill.displayName}
        // The registry's own name, where it differs: it is what a Skill is called
        // in a prompt or a log, and the label alone hides that.
        subtitle={skill.name !== skill.displayName ? skill.name : null}
        description={skill.description || null}
        dimmed={!skill.enabled}
      />
      <SwitchCell switching={switching}>
        <Switch
          checked={skill.enabled}
          disabled={switching}
          onCheckedChange={onToggle}
          aria-label={`${skill.enabled ? "Switch off" : "Switch on"} ${skill.displayName}`}
        />
      </SwitchCell>
    </Row>
  );
}

/// One MCP server: whether it answers, what it offers, and the controls on it.
///
/// **Everything about a server is on its own row**, which is the difference between
/// this list and the one above it. A Skill is a document — you read it — so its row
/// opens a pane. A server is a *connection*, and the three things a reader does with
/// one are glance at whether it works, switch it, and throw it away; making any of
/// those a trip into the pane is a trip for something the row has space to say.
///
/// The name still opens the pane, because editing is the one act that needs a form.
function McpRow({
  server,
  test,
  expanded,
  confirming,
  selected,
  switching,
  onSelect,
  onToggleExpanded,
  onToggle,
  onAskDelete,
  onBlurDelete,
  onDelete,
}: {
  server: PluginMcpServer;
  test: McpTestState | undefined;
  expanded: boolean;
  confirming: boolean;
  selected: boolean;
  switching: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onToggle: (enabled: boolean) => void;
  onAskDelete: () => void;
  onBlurDelete: () => void;
  onDelete: () => void;
}) {
  const answer = test?.state === "done" ? test.result : null;
  const tools = answer?.tools ?? [];

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg transition-colors",
        selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-ui">
        <StatusMark test={test} enabled={server.enabled} />

        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          {/* Switched off is dimmed rather than struck through: it is not gone, and
              the row is still the one to press to bring it back. */}
          <span className={cn("min-w-0 max-w-full truncate font-medium", !server.enabled && "text-muted-foreground")}>
            {server.name}
          </span>
          <span className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground/70">
            {serverEndpoint(server)}
          </span>
        </button>

        {/* **A count, never a bare "connected".** What a reader wants to know is
            whether the thing they wired up does what they wired it up for, and a
            server that answers with nothing looks exactly like a working one
            otherwise. The mark beside it is a glance, not the answer — colour is
            the thing this palette can least afford to make load-bearing. */}
        {answer?.success && (
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {tools.length} {tools.length === 1 ? "tool" : "tools"}
          </span>
        )}

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide what ${server.name} offers` : `Show what ${server.name} offers`}
          className="shrink-0 cursor-pointer text-muted-foreground"
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </Button>

        {switching && <Spinner className="size-3.5 shrink-0 text-muted-foreground" />}
        <Switch
          checked={server.enabled}
          disabled={switching}
          onCheckedChange={onToggle}
          aria-label={`${server.enabled ? "Switch off" : "Switch on"} ${server.name}`}
        />

        <Button
          variant="ghost"
          size="icon-xs"
          // Confirmed in the control rather than in a dialog, the bargain the branch
          // and model deletes make: this removes one row the reader can see.
          onClick={() => (confirming ? onDelete() : onAskDelete())}
          onBlur={onBlurDelete}
          aria-label={confirming ? `Delete ${server.name} for good` : `Delete ${server.name}`}
          className={cn(
            "shrink-0 cursor-pointer",
            confirming ? "text-destructive" : "text-muted-foreground/50",
          )}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {expanded && (
        // Scrolled rather than grown without limit: a server may offer sixty tools,
        // and a row that pushes the rest of the list off the screen is a row that
        // has to be collapsed before anything else can be done.
        <div className="max-h-72 overflow-y-auto px-3 pb-2.5 pl-8">
          {test?.state === "testing" && (
            <p className="text-ui text-muted-foreground">Connecting…</p>
          )}
          {answer && !answer.success && (
            <p className="text-balance text-ui text-destructive">{describeTest(answer)}</p>
          )}
          {answer?.success && tools.length === 0 && (
            <p className="text-ui text-muted-foreground">
              It connected and offers no tools.
            </p>
          )}
          {tools.length > 0 && (
            <ul className="flex flex-col gap-1">
              {tools.map((tool) => (
                // One line each, the name fixed and the sentence giving way: sixty
                // tools are read down the names, and a description that wrapped
                // would turn the list into a wall.
                <li key={tool.name} className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-xs">{tool.name}</span>
                  {tool.description && (
                    <span className="min-w-0 truncate text-xs text-muted-foreground/80">
                      {tool.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/// Whether a server answers, at a glance.
///
/// Three states and a fourth for one that is switched off: a server that is off is
/// never dialled — the agent refuses it rather than connecting — so drawing it as
/// "not tested" would be a mark waiting for an answer that is not coming.
function StatusMark({ test, enabled }: { test: McpTestState | undefined; enabled: boolean }) {
  if (!enabled) {
    return <Mark className="bg-muted-foreground/25" label="Switched off" />;
  }
  if (test?.state === "testing") {
    return <Mark className="animate-pulse bg-muted-foreground/50" label="Connecting" />;
  }
  if (test?.state !== "done") {
    return <Mark className="bg-muted-foreground/25" label="Not asked yet" />;
  }
  return test.result.success ? (
    <Mark className="bg-accent-add" label="Connected" />
  ) : (
    <Mark className="bg-destructive" label="Could not connect" />
  );
}

function Mark({ className, label }: { className: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("mt-0.5 size-1.5 shrink-0 self-start rounded-full", className)}
    />
  );
}

/// A Skill's row: the box, its two columns, and the one place the selected state is
/// drawn.
///
/// The servers' rows do not use this — theirs carry four controls and an expansion,
/// which is a different shape of row rather than the same one with more in it.
function Row({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg px-3 py-2 text-ui transition-colors",
        selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
      )}
    >
      {children}
    </div>
  );
}

/// The clickable half of a row.
///
/// `aria-pressed` on this rather than a class on the row, so the row's own hover
/// and the selected state read from one place — the bargain `PrsView`'s rows make.
function RowBody({
  selected,
  onSelect,
  title,
  subtitle,
  description,
  dimmed,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string | null;
  description: string | null;
  dimmed: boolean;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      // The row answers only its own keys, or Enter on the switch would open the
      // thing in the same press it was switched.
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      className="flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        {/* Switched off is dimmed rather than struck through: it is not gone, and
            the row is still the one to press to bring it back. */}
        <span className={cn("min-w-0 truncate font-medium", dimmed && "text-muted-foreground")}>
          {title}
        </span>
        {subtitle && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground/70">
            {subtitle}
          </span>
        )}
      </span>
      {description && <span className="line-clamp-2 text-muted-foreground">{description}</span>}
    </span>
  );
}

/// The switch, with its click stopped before it reaches the row underneath.
function SwitchCell({ switching, children }: { switching: boolean; children: ReactNode }) {
  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {switching && <Spinner className="size-3.5 text-muted-foreground" />}
      {children}
    </span>
  );
}

/// A read or a write that went wrong, in the agent's own words where it had them.
function Problem({ detail }: { detail: string }) {
  return (
    <div className="mx-1 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{detail}</span>
    </div>
  );
}

/// An empty state that fills the box it is centred in.
///
/// `h-full` because the scroller is not a flex column: this is the one child that
/// has to fill it.
function Filler({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="flex max-w-72 flex-col items-center gap-2.5 text-center">
          <Server className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
          <p className="text-balance text-ui text-muted-foreground">{children}</p>
        </div>
      </div>
    </div>
  );
}
