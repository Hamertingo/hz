import { invoke } from "@tauri-apps/api/core";
import { Eye, FileText, RefreshCw, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { SkeletonRegion, SkeletonRows } from "@/components/ui/skeleton";
import { Blk, agoLabel } from "@/components/profile/parts";
import type { ProfileProps } from "@/components/profile/AgentProfile";
import VersionSheet from "@/components/profile/VersionSheet";
import WorkspaceLogo from "@/components/WorkspaceLogo";
import { useLayers, useVersions } from "@/hooks/useAgentProfile";
import { estimateTokens, tokLabel } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import type { InstrVersion, LayerInfo } from "@/types/events";

const SNIPPETS = [
  "Answer in Portuguese",
  "End with a recommendation",
  "Ask before spending",
  "Cite sources",
  "Keep it short",
];

/// How long after the last keystroke the instructions are written down.
const AUTOSAVE_MS = 900;

/// Colours of the token bar, one per part, in the order the agent reads them.
function barColor(key: string): string {
  if (key === "instructions") return "var(--tint)";
  return key === "workspace" || key === "person" ? "var(--ink3)" : "var(--ink4)";
}

export default function ProfileInstructions({
  agent,
  teammates,
  workspace,
  onChange,
  onTab,
  onOpenSettings,
  noteCount,
}: ProfileProps & { noteCount: number }) {
  const { versions, reload } = useVersions(agent.id);
  const [text, setText] = useState(agent.instructions);
  const [saving, setSaving] = useState(false);
  const [compare, setCompare] = useState<{ from: InstrVersion } | null>(null);
  const latest = useRef({ agent, text, onChange });
  latest.current = { agent, text, onChange };
  // What this tab last wrote to the roster, so the roster echoing it back does
  // not overwrite keystrokes typed while the save was in flight.
  const written = useRef(agent.instructions);

  // Another room changed the instructions (a restore, an edit elsewhere).
  useEffect(() => {
    if (agent.instructions === written.current) return;
    written.current = agent.instructions;
    setText(agent.instructions);
  }, [agent.id, agent.instructions]);

  // An agent that had instructions before versions existed gets them as V1, so
  // the history starts from what it is actually reading.
  const seeded = useRef(false);
  useEffect(() => {
    if (versions === null || versions.length > 0 || seeded.current || !agent.instructions.trim()) return;
    seeded.current = true;
    void invoke("agent_instr_save", { agentId: agent.id, text: agent.instructions, summary: "First version" }).then(reload);
  }, [versions, agent.id, agent.instructions, reload]);

  // Written a moment after the last keystroke. The roster takes the text first,
  // because the roster is what the next briefing is built from; the version file
  // is the history behind it.
  useEffect(() => {
    if (text === latest.current.agent.instructions) return;
    setSaving(true);
    const timer = setTimeout(async () => {
      const current = latest.current;
      written.current = current.text;
      current.onChange({ ...current.agent, instructions: current.text });
      try {
        await invoke("agent_instr_save", { agentId: current.agent.id, text: current.text, summary: null });
        await reload();
      } catch (e) {
        toast(`Could not save a version: ${String(e)}`);
      }
      setSaving(false);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const layers = useLayers(agent.id, `${agent.instructions}|${agent.alwaysAsk?.length}|${agent.folders?.length}|${agent.toolsOff?.join()}|${teammates.length}|${noteCount}`);
  const mine = layers.find((l) => l.key === "instructions");
  // The identity line is part of this layer; only the typed text moves live.
  const liveTokens = mine ? Math.max(0, mine.tokens - estimateTokens(agent.instructions) + estimateTokens(text)) : estimateTokens(text);
  const sized: LayerInfo[] = layers.map((l) => (l.key === "instructions" ? { ...l, tokens: liveTokens } : l));
  const total = sized.reduce((a, l) => a + l.tokens, 0);

  const newest = versions?.[0]?.n;

  const addSnippet = (s: string) => {
    const line = `${s}.`;
    if (text.includes(line)) return;
    setText(`${text.trimEnd()}${text.trim() ? "\n\n" : ""}${line}`);
  };

  const openCompare = async (n: number) => {
    try {
      setCompare({ from: await invoke<InstrVersion>("agent_instr_read", { agentId: agent.id, n }) });
    } catch (e) {
      toast(String(e));
    }
  };

  const restore = async (n: number) => {
    try {
      const made = await invoke<InstrVersion>("agent_instr_restore", { agentId: agent.id, n });
      onChange({ ...agent, instructions: made.text });
      written.current = made.text;
      setText(made.text);
      await reload();
      toast(`Restored V${n} as V${made.n}`);
    } catch (e) {
      toast(String(e));
    }
  };

  const status = saving ? "Saving…" : `Saved${newest ? ` · V${newest}` : ""}`;

  return (
    <div className="grid grid-cols-[1fr_310px] gap-8 max-[860px]:grid-cols-1">
      <div className="self-start overflow-hidden rounded-(--r4) bg-s1 shadow-[inset_0_0_0_1px_var(--line)]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs text-ink3">
          <FileText className="size-[13px]" /> instructions.md
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px]">
            <i className={cn("size-1.5 rounded-full", saving ? "bg-amber" : "bg-green")} />
            {status}
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Instructions"
          placeholder={`How ${agent.name} should work, what it should know, how it should talk.`}
          className="block min-h-[420px] w-full resize-y bg-transparent px-7 py-6 text-sm leading-[1.75] text-ink2 outline-none placeholder:text-ink4"
        />
        <div className="flex flex-wrap gap-1.5 border-t border-line px-3.5 py-2.5">
          {SNIPPETS.filter((s) => !text.includes(`${s}.`)).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addSnippet(s)}
              className="h-[26px] cursor-pointer rounded-full bg-s2 px-2.5 text-xs text-ink3 transition-colors hover:bg-s3 hover:text-ink"
            >
              + {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-[34px]">
        <Blk title={`What ${agent.name} reads first`}>
          <div className="flex flex-col gap-1.5">
            {sized.map((l, i) => {
              const goes = l.key === "workspace" ? () => onOpenSettings("workspace") : l.key === "person" ? () => onOpenSettings("profile") : l.key === "memory" ? () => onTab("memory") : l.key === "rules" || l.key === "folders" ? () => onTab("access") : undefined;
              const icon =
                l.key === "workspace" && workspace ? (
                  <WorkspaceLogo {...workspace} size={16} />
                ) : l.key === "instructions" ? (
                  <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={16} />
                ) : l.key === "team" ? (
                  <Users className="size-[13px] text-ink3" />
                ) : (
                  <FileText className="size-[13px] text-ink3" />
                );
              const body = (
                <>
                  <div className="flex items-center gap-2 text-[12.5px] font-medium">
                    <span className="w-3 text-[11px] font-normal text-ink4 tabular-nums">{i + 1}</span>
                    {icon}
                    {l.label}
                    <span className="ml-auto text-[11.5px] font-normal text-ink4">{tokLabel(l.tokens)}</span>
                  </div>
                  <div className="mt-1 truncate pl-5 text-xs leading-[1.45] text-ink3">
                    {l.key === "instructions" ? "The part you are editing." : l.key === "memory" ? `${noteCount} ${noteCount === 1 ? "note" : "notes"}. Each is read when it matters.` : l.key === "team" ? `${teammates.map((t) => t.name).join(", ")} — and how to ask them.` : l.preview}
                  </div>
                </>
              );
              const cls = cn(
                "block w-full rounded-(--r3) bg-s1 px-3 py-[11px] text-left shadow-[inset_0_0_0_1px_var(--line)]",
                goes && "cursor-pointer hover:bg-s2",
                l.key === "instructions" && "bg-(--tint)/6 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--tint)_45%,transparent)]",
              );
              return goes ? (
                <button key={l.key} type="button" onClick={goes} className={cls}>
                  {body}
                </button>
              ) : (
                <div key={l.key} className={cls}>
                  {body}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex h-[5px] gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {sized.map((l) => (
              <i key={l.key} className="block h-full" style={{ width: `${(l.tokens / Math.max(1, total)) * 100}%`, background: barColor(l.key) }} />
            ))}
          </div>
          <div className="mt-2 text-xs text-ink4">
            About {total.toLocaleString("en-US")} tokens (four characters to a token, an estimate) ·{" "}
            {agent.harness === "claude-acp" ? "sent as the system prompt, so it stays cached" : "sent again whenever it changes"}
          </div>
        </Blk>

        <Blk title="History">
          {versions === null ? (
            <SkeletonRegion label="Reading versions">
              <SkeletonRows count={3} avatar="none" trailing />
            </SkeletonRegion>
          ) : versions.length === 0 ? (
            <p className="text-[13px] text-ink3">Each save becomes a version here.</p>
          ) : (
            <div>
              {versions.map((v) => (
                <DropdownMenu key={v.n}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2.5 border-t border-line py-2 text-left text-[12.5px] first:border-t-0"
                    >
                      <span className="w-[22px] text-[11px] text-ink4 tabular-nums">V{v.n}</span>
                      <span className="truncate">{v.summary}</span>
                      <span className="ml-auto shrink-0 text-[11.5px] text-ink4">{agoLabel(v.atMs)}</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => void openCompare(v.n)}>
                      <Eye /> Compare with now
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={v.n === newest} onSelect={() => void restore(v.n)}>
                      <RefreshCw /> Restore V{v.n}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
            </div>
          )}
        </Blk>
      </div>

      <VersionSheet
        open={compare !== null}
        onOpenChange={(o) => !o && setCompare(null)}
        fromLabel={compare ? `V${compare.from.n}` : ""}
        toLabel={newest ? `V${newest} (now)` : "now"}
        before={compare?.from.text ?? ""}
        after={text}
      />
    </div>
  );
}
