import { open } from "@tauri-apps/plugin-dialog";
import { Folder } from "lucide-react";

import { PaymentsRows } from "@/components/settings/AgentKeys";
import { CommandReviewDefault } from "@/components/safety/SafetyRows";
import SettingsSkeleton from "@/components/settings/SettingsSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import AgentIcon from "@/components/AgentIcon";
import { SetHeading, StudioRow } from "@/components/settings/StudioRow";
import { fieldClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { honouredModes, MODE_COPY } from "@/lib/permission";
import { AGENT_HARNESSES } from "@/lib/roster";
import { validTime } from "@/lib/studio";
import { cn } from "@/lib/utils";
import type { ApprovalPolicy, Harness, WorkspaceDefaults } from "@/types/events";

const CLI_NAME: Record<string, string> = { "claude-acp": "Claude", "codex-acp": "Codex", opencode: "OpenCode" };

const STANCE_ORDER: ApprovalPolicy[] = ["plan", "manual", "auto", "bypassPermissions"];

/// Settings → Agent defaults: what a new agent in this workspace starts with,
/// and how the team behaves together. Stored on the workspace; the new-agent
/// card, the team server, the nightly tidy and the limit fallback read it.
export default function DefaultsSettings() {
  const { active, setDefaults } = useWorkspaces();
  const availability = useAgentAvailability();
  if (!active) return <SettingsSkeleton />;

  const d = active.defaults;
  const save = (patch: Partial<WorkspaceDefaults>) => void setDefaults(active.id, { ...d, ...patch });

  const harness = (AGENT_HARNESSES.find((h) => h === d.harness) ??
    AGENT_HARNESSES.find((h) => availability?.find((a) => a.harness === h)?.available) ??
    "claude-acp") as Harness;
  const stances = STANCE_ORDER.filter((m) => honouredModes(harness).includes(m));
  const perm = stances.find((m) => m === d.permission) ?? (stances.includes("auto") ? "auto" : stances[0]);

  const pickFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") save({ folder: picked });
  };

  return (
    <>
      <SetHeading>New agents start with</SetHeading>
      <div>
        <StudioRow stack label="Runs on">
          <div className="grid w-full grid-cols-3 gap-2.5" role="radiogroup" aria-label="Runs on">
            {AGENT_HARNESSES.map((h) => {
              const info = availability?.find((a) => a.harness === h);
              const on = harness === h;
              return (
                <button
                  key={h}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => save({ harness: h, permission: null })}
                  className={cn(
                    "cursor-pointer rounded-(--r3) bg-s1 px-3.5 py-3 text-left shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow hover:shadow-[inset_0_0_0_1px_var(--line3)] focus-visible:ring-2 focus-visible:ring-ring/50",
                    on && "shadow-[inset_0_0_0_1.5px_var(--ink)]",
                  )}
                >
                  <span className="flex items-center gap-2 text-[13px] font-[550] text-ink">
                    <AgentIcon harness={h} className="size-[15px]" />
                    {CLI_NAME[h]}
                  </span>
                  <span className="mt-1 block text-xs text-ink3">
                    {availability === null ? (
                      <Skeleton className="h-2.5 w-14" />
                    ) : info && !info.available ? (
                      "Not installed"
                    ) : (
                      "Installed"
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </StudioRow>

        <StudioRow label="Can do" hint="How far a new agent goes before it asks. Merges and deploys always ask you.">
          <Segmented<ApprovalPolicy>
            label="Can do"
            value={perm}
            onChange={(permission) => save({ permission })}
            options={stances.map((m) => ({ value: m, label: MODE_COPY[m].label }))}
          />
        </StudioRow>

        <StudioRow label="Folder" hint="Where a new agent works unless you pick another.">
          <button
            type="button"
            onClick={() => void pickFolder()}
            className={cn(fieldClassName, "flex cursor-pointer items-center gap-2 text-left font-mono text-xs")}
          >
            <Folder className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{d.folder ?? "The project you have open"}</span>
          </button>
          {d.folder && (
            <button type="button" className="text-xs text-ink3 hover:text-ink2" onClick={() => save({ folder: null })}>
              Clear
            </button>
          )}
        </StudioRow>

        <StudioRow label="Say hello on create" hint="The agent introduces itself in its first message.">
          <Switch aria-label="Say hello on create" checked={d.sayHello} onCheckedChange={(sayHello) => save({ sayHello })} />
        </StudioRow>
      </div>

      <SetHeading>Memory</SetHeading>
      <div>
        <StudioRow
          label="Tidy memory at night"
          hint="Each agent merges duplicate notes and drops stale ones. It is a real turn on its own chat, so it spends a little of the plan; agents with fewer than two notes are skipped."
        >
          <Switch aria-label="Tidy memory at night" checked={d.tidy} onCheckedChange={(tidy) => save({ tidy })} />
          <input
            type="time"
            aria-label="Tidy time"
            value={d.tidyTime}
            disabled={!d.tidy}
            onChange={(e) => validTime(e.target.value) && save({ tidyTime: e.target.value })}
            className={cn(fieldClassName, "w-[110px] px-2.5 py-1.5 font-mono")}
          />
        </StudioRow>
        <StudioRow
          label="Shared memory"
          hint="Notes every agent in the workspace can read and write. They reach it by starting a note's name with shared/."
        >
          <Switch
            aria-label="Shared memory"
            checked={d.sharedMemory}
            onCheckedChange={(sharedMemory) => save({ sharedMemory })}
          />
        </StudioRow>
      </div>

      <SetHeading>Working together</SetHeading>
      <div>
        <StudioRow
          label="Back and forth between agents"
          hint="How many times a conversation between agents can go back and forth before it stops. Each message and each answer counts once."
        >
          <Segmented
            label="Back and forth between agents"
            value={String(d.handoffs)}
            onChange={(n) => save({ handoffs: Number(n) })}
            options={optionsWith([4, 8, 12], d.handoffs).map((n) => ({ value: String(n), label: String(n) }))}
          />
        </StudioRow>
        <StudioRow
          label="When a CLI hits its limit"
          hint="Wait resends to the same agent after the reset. Move sends the request to a Codex agent here, with a note. Ask puts the choice in your Inbox."
        >
          <Segmented
            label="When a CLI hits its limit"
            value={d.onLimit}
            onChange={(onLimit) => save({ onLimit })}
            options={[
              { value: "wait", label: "Wait" },
              { value: "move", label: "Move to Codex" },
              { value: "ask", label: "Ask me" },
            ]}
          />
        </StudioRow>
      </div>

      <SetHeading>Safety</SetHeading>
      <div>
        <CommandReviewDefault />
      </div>
      <PaymentsRows />
    </>
  );
}

/// The preset choices, plus the stored value when it is none of them, so a value
/// set some other way still shows as the selected one.
export function optionsWith(presets: number[], current: number): number[] {
  return presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
}
