import { ArrowLeft, Smile } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import BrandMark from "@/components/BrandMark";
import PixelBanner from "@/components/PixelBanner";
import { Button } from "@/components/ui/button";
import { homeShort } from "@/components/chat/AgentChatHeader";
import { ModelMenu, modelLabel, useModels } from "@/components/profile/ConfigMenus";
import ProfileAccess from "@/components/profile/ProfileAccess";
import ProfileActivity from "@/components/profile/ProfileActivity";
import ProfileInstructions from "@/components/profile/ProfileInstructions";
import ProfileMemory from "@/components/profile/ProfileMemory";
import ProfileOverview from "@/components/profile/ProfileOverview";
import { useActivity, useNotes } from "@/hooks/useAgentProfile";
import { useAgentGlances } from "@/hooks/useAgentGlances";
import { CLI } from "@/lib/cli";
import { heroNumbers, workClock } from "@/lib/heatmap";
import { inkTint } from "@/lib/mascots";
import type { RosterAgent } from "@/lib/roster";
import { useJumpTarget } from "@/lib/jumpTarget";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types/events";

export type ProfileTab = "overview" | "instructions" | "memory" | "access" | "activity";

export const PROFILE_TABS: readonly { key: ProfileTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "instructions", label: "Instructions" },
  { key: "memory", label: "Memory" },
  { key: "access", label: "Access" },
  { key: "activity", label: "Activity" },
];

export type ProfileProps = {
  agent: RosterAgent;
  /// Everyone else in the same workspace.
  teammates: RosterAgent[];
  workspaces: Workspace[];
  workspace: Workspace | undefined;
  /// The agent is mid-turn.
  working: boolean;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  /// Back to the agent's chat.
  onBack: () => void;
  /// Opens the Edit look form. Phase E owns the form; this only asks for it.
  onEditLook: () => void;
  /// Writes the agent back to the roster.
  onChange: (next: RosterAgent) => void;
  onOpenAgent: (id: string) => void;
  onOpenPlugins: () => void;
  onOpenSettings: (tab: "profile" | "workspace") => void;
};

/// An agent's page: who it is, what it has done and what it may do. It replaces
/// the pane's Agent tab; every control on it writes to the same roster entry the
/// rest of the app reads, and the numbers come from the agent's own log.
export default function AgentProfile(props: ProfileProps) {
  const { agent, tab, onTab, working } = props;
  const glance = useAgentGlances(agent.sessionId ? [agent.sessionId] : [])[agent.sessionId ?? ""];
  const scan = useActivity(agent.id, glance?.atMs ?? null);
  const { notes, usage, reload, hold } = useNotes(agent.id, tab === "memory" || tab === "overview");
  const models = useModels(agent.harness);
  const cli = CLI[agent.harness];

  // A note another tab asked to show: the Memory tab opens on it.
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const openNote = (name: string) => {
    setFocusNote(name);
    onTab("memory");
  };
  // Jump to → In memory names the agent and the note.
  useJumpTarget("memory", (t) => {
    if (t.agentId === agent.id) openNote(t.note);
  });

  const now = Date.now();
  const nums = useMemo(() => (scan ? heroNumbers(scan, now) : null), [scan, Math.floor(now / 60_000)]);
  const noteCount = notes?.length ?? 0;
  const bar = Math.max(1, ...(nums?.days ?? [1]));
  const work = workClock(nums?.workSecsThisMonth ?? 0);

  // The page is one scroll; a tab change goes back to the top of its content.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [agent.id]);

  const tile = (go: ProfileTab, value: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onTab(go)}
      className="cursor-pointer rounded-(--r3) bg-s1 px-4 py-3.5 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors outline-none hover:bg-s2 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-baseline gap-[5px] text-[22px] font-semibold tracking-[-0.02em] tabular-nums">
        {value}
        {extra}
      </div>
      <div className="mt-[3px] text-xs text-ink3">{label}</div>
    </button>
  );

  const small = (t: string) => <small className="text-xs font-[450] tracking-normal text-ink3">{t}</small>;

  return (
    <div
      ref={scroller}
      className="h-full min-h-0 flex-1 overflow-y-auto"
      style={{ ["--tint" as string]: agent.color }}
    >
      <div className="relative">
        <PixelBanner id={`${agent.id}:banner`} kind={agent.kind} color={agent.color} height={200} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[110px] bg-linear-to-b from-transparent to-background" />
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onBack}
          className="absolute top-3.5 left-4 bg-black/45 text-white backdrop-blur-md hover:bg-black/60 hover:text-white"
        >
          <ArrowLeft /> Chat
        </Button>
      </div>

      <div className="mx-auto max-w-[960px] px-10 pb-[70px]">
        <button
          type="button"
          onClick={props.onEditLook}
          aria-label="Edit look"
          className="relative -mt-[68px] block w-max cursor-pointer rounded-[34px] bg-background p-[5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={120} />
        </button>

        <div className="flex items-end gap-4 pt-3">
          <div className="min-w-0">
            <h1 className="truncate text-[30px] leading-[1.1] font-[650] tracking-[-0.03em]">{agent.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink2">
              {agent.role && <span>{agent.role}</span>}
              {agent.role && <Dot />}
              {cli?.brand && <BrandMark slug={cli.brand} size={13} bare />}
              <span>{cli?.label ?? agent.harness}</span>
              <Dot />
              <ModelMenu agent={agent} models={models} onChange={props.onChange} align="start">
                <button type="button" className="cursor-pointer text-ink3 transition-colors hover:text-ink">
                  {modelLabel(models, agent)}
                </button>
              </ModelMenu>
              <Dot />
              <span className="text-ink3">{homeShort(agent.projectPath)}</span>
              <Dot />
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[11px] font-medium before:size-[5px] before:rounded-full before:bg-current"
                style={
                  working
                    ? { color: inkTint(agent.color, 0.4), background: `${agent.color}29` }
                    : { color: "var(--ink3)", background: "var(--s3)" }
                }
              >
                {working ? "Working" : "Idle"}
              </span>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={props.onEditLook}>
              <Smile /> Edit look
            </Button>
            <Button variant="solid" onClick={props.onBack}>
              Message {agent.name}
            </Button>
          </div>
        </div>

        <div className="mt-[26px] grid grid-cols-4 gap-2 max-[760px]:grid-cols-2">
          {tile(
            "activity",
            <>
              {nums?.messages14 ?? "–"}
              <span className="mr-0 ml-auto flex h-4 items-end gap-0.5" aria-hidden>
                {(nums?.days ?? []).map((n, i) => (
                  <i
                    key={i}
                    className="w-1 rounded-[1px] bg-(--tint) opacity-70"
                    style={{ height: Math.max(2, Math.round((n / bar) * 16)) }}
                  />
                ))}
              </span>
            </>,
            "Messages · 14 days",
          )}
          {tile("activity", <>{nums?.tasksThisMonth ?? "–"}</>, "Finished this month", small("tasks"))}
          {tile("memory", <>{notes ? noteCount : "–"}</>, "In memory", small(noteCount === 1 ? "note" : "notes"))}
          {tile(
            "activity",
            <>
              {work.h}
              {small("h")} {work.m}
              {small("m")}
            </>,
            "Of work this month",
          )}
        </div>

        <div className="my-[26px] flex gap-1 border-b border-line" role="tablist">
          {PROFILE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => onTab(t.key)}
              className={cn(
                "-mb-px flex cursor-pointer items-center gap-[7px] border-b-[1.5px] px-2.5 py-[9px] font-medium transition-colors outline-none focus-visible:text-ink",
                tab === t.key ? "border-ink text-ink" : "border-transparent text-ink3 hover:text-ink2",
              )}
            >
              {t.label}
              {t.key === "memory" && notes && noteCount > 0 && (
                <em className="text-[11px] font-normal text-ink4 not-italic">{noteCount}</em>
              )}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <ProfileOverview {...props} scan={scan} notes={notes} models={models} glance={glance} onOpenNote={openNote} />
        )}
        {tab === "instructions" && <ProfileInstructions {...props} noteCount={noteCount} />}
        {tab === "memory" && (
          <ProfileMemory agent={agent} notes={notes} usage={usage} reload={reload} hold={hold} onChange={props.onChange} focus={focusNote} />
        )}
        {tab === "access" && <ProfileAccess {...props} scan={scan} />}
        {tab === "activity" && (
          <ProfileActivity agent={agent} scan={scan} onBack={props.onBack} onOpenNote={openNote} />
        )}
      </div>
    </div>
  );
}

function Dot() {
  return <i className="size-[3px] rounded-full bg-ink4" aria-hidden />;
}
