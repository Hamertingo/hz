import { invoke } from "@tauri-apps/api/core";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import AgentTile from "@/components/AgentTile";
import { Group, Empty, Row, SearchField, Val } from "@/components/kit/kit";
import { SetHeading } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { composeNote } from "@/lib/memoryNotes";
import { inWorkspace, useRoster, type RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

type MemoryFile = { name: string; size: number; modifiedMs: number };

/// How many notes each agent holds, read once per agent. The index file is not a note.
function useNoteCounts(agents: readonly RosterAgent[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = agents.map((a) => a.id).join();
  useEffect(() => {
    let live = true;
    for (const a of agents) {
      invoke<MemoryFile[]>("agent_memory_list", { agentId: a.id })
        .then((files) => live && setCounts((c) => ({ ...c, [a.id]: files.filter((f) => f.name !== "MEMORY.md").length })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
    // The ids are the dependency; `agents` is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [counts, setCounts] as const;
}

/// Settings → Memories: teach every agent in the workspace one thing at once, and see what each
/// one has kept. A taught line is written as an ordinary note, so each agent can edit or forget it.
export default function MemoriesSettings({ onOpen }: { onOpen?: (agentId: string) => void }) {
  const roster = useRoster();
  const { active } = useWorkspaces();
  const agents = useMemo(
    () => roster.agents.filter((a) => (active ? inWorkspace(a, active.id) : true)),
    [roster.agents, active],
  );
  const [counts, setCounts] = useNoteCounts(agents);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = agents.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase()));

  const teach = async () => {
    const line = text.trim();
    if (!line || busy) return;
    setBusy(true);
    const name = `taught-${Date.now().toString(36)}.md`;
    const body = composeNote([["tag", "About you"]], `${line}\n`);
    let done = 0;
    for (const a of agents) {
      try {
        await invoke("agent_memory_write", { agentId: a.id, name, content: body });
        done += 1;
        setCounts((c) => ({ ...c, [a.id]: (c[a.id] ?? 0) + 1 }));
      } catch (e) {
        console.error("[memories]", a.id, e);
      }
    }
    setBusy(false);
    if (done > 0) setText("");
    toast(done === agents.length ? "Every agent will remember it" : `${done} of ${agents.length} agents took it`);
  };

  return (
    <>
      <SetHeading>Teach every agent</SetHeading>
      <Group>
        <div className="flex items-center gap-[11px] px-3 py-[9px]">
          <input
            aria-label="Teach every agent"
            value={text}
            placeholder="e.g. I prefer short answers"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void teach()}
            className={cn(fieldClassName, "flex-1")}
          />
          <Button variant="solid" disabled={!text.trim() || busy || agents.length === 0} onClick={() => void teach()}>
            Teach
          </Button>
        </div>
      </Group>

      <div className="mx-1 mt-3 flex items-center gap-1.5">
        <b className="text-xs font-medium text-ink3">What each agent kept</b>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" className="ml-auto h-7 w-[210px]" />
      </div>
      <Group>
        {shown.map((a) => (
          <Row
            key={a.id}
            bareLead
            lead={<AgentTile id={a.id} kind={a.kind} color={a.color} shape={a.shape} look={a.look} photo={a.photo} size={26} />}
            title={a.name}
            onClick={onOpen ? () => onOpen(a.id) : undefined}
            right={
              <Val>
                {counts[a.id] ?? "…"}
                {onOpen ? <ChevronRight /> : null}
              </Val>
            }
          />
        ))}
        {shown.length === 0 && <Empty>No agent matches.</Empty>}
      </Group>
    </>
  );
}
