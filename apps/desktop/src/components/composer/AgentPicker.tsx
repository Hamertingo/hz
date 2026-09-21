import { Bot, Check, ChevronDown } from "lucide-react";

import AgentAvatar from "@/components/plugins/AgentAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePluginAgents } from "@/hooks/usePluginAgents";
import { cn } from "@/lib/utils";

/// Which Agent a new chat runs *as*.
///
/// **The composer is the only place this is chosen, and that is the runtime's
/// rule rather than this app's.** An Agent is composed into a session when the
/// session is made — prompt, tools, model and all — so a session that already
/// exists keeps the one it was created with; there is nothing to switch. The
/// picker is therefore drawn only before a conversation starts, and the control
/// disappears the moment one does.
///
/// **It is also a different question from the Subagents tab.** Choosing an Agent
/// here is what this chat *is*; what it delegates to is the `task` tool's
/// business, and the panel's. The two share a roster and nothing else.
///
/// **One sticky pick, not one per project.** An Agent is a stored prompt and
/// identity rather than a workspace fact, so somebody who wants their changelog
/// agent wants it wherever they are — see `ComposerPrefs.agentName`.
export default function AgentPicker({
  agentName,
  onSelect,
  className,
}: {
  /// The store's own name for the Agent, or `null` for the runtime's default.
  agentName: string | null;
  onSelect: (agentName: string | null) => void;
  className?: string;
}) {
  // The page caches this for a minute, so opening the menu is usually free —
  // and a menu opened before any read shows the current pick's name rather than
  // nothing, which is why the label falls back to the stored name.
  const agents = usePluginAgents(true);
  const roster = agents.agents ?? [];
  const picked = roster.find((agent) => agent.name === agentName) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("cursor-pointer gap-1.5 text-muted-foreground", className)}
          // The name, never the word "Agent": the reader is choosing *who* runs
          // this chat, and a control labelled with its own category says nothing
          // about what is selected.
          aria-label="The agent this chat runs as"
        >
          {picked ? (
            <AgentAvatar agent={picked} size={16} live />
          ) : (
            <Bot className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 max-w-40 truncate">
            {picked?.displayName ?? "Default agent"}
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>This chat runs as</DropdownMenuLabel>

        <DropdownMenuItem onSelect={() => onSelect(null)} className="cursor-pointer gap-2">
          <Bot className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Default agent</span>
          {agentName === null && <Check className="size-3.5 shrink-0" />}
        </DropdownMenuItem>

        {roster.length > 0 && <DropdownMenuSeparator />}

        {roster.map((agent) => (
          <DropdownMenuItem
            key={agent.name}
            onSelect={() => onSelect(agent.name)}
            className="cursor-pointer gap-2"
          >
            <AgentAvatar agent={agent} size={16} paper="var(--popover, var(--background))" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="min-w-0 truncate">{agent.displayName}</span>
              {agent.description && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {agent.description}
                </span>
              )}
            </span>
            {agentName === agent.name && <Check className="size-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}

        {/* A read that failed is worth saying here rather than drawing an empty
            menu: the composer is the one place this choice exists, and a menu
            with only "Default agent" in it reads as a machine with no agents. */}
        {agents.error && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs text-destructive">{agents.error}</div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
