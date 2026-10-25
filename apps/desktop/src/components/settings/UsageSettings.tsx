import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";

import AgentIcon from "@/components/AgentIcon";
import AgentTile from "@/components/AgentTile";
import { Lead, SetHeading, StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import Spinner from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { CLI_ORDER, useLimits, useSpend } from "@/hooks/useUsage";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useRoster } from "@/lib/roster";
import {
  csvFileName,
  isWarn,
  litCells,
  parseUsd,
  pctText,
  resetNote,
  sourceNote,
  usd,
} from "@/lib/limits";
import { cn } from "@/lib/utils";
import type { CliLimits, Harness, LimitWindow, WorkspaceDefaults } from "@/types/events";

const CLI_NAME: Record<string, string> = { "claude-acp": "Claude", "codex-acp": "Codex", opencode: "OpenCode" };

/// The plans hz can size an estimate for, by CLI.
const PLAN_CHOICES: Record<string, string[]> = { "claude-acp": ["Pro", "Max"], "codex-acp": ["Plus", "Pro"] };

/// The bar's lit colour per CLI, as the mockup tints them: Claude's clay, and the
/// ink for any other (the mockup's Codex paper is the dark theme's ink).
const TINT: Record<string, string> = { "claude-acp": "#d97757" };

function Bar({ pct, warn, tint }: { pct: number | null; warn: boolean; tint?: string }) {
  const lit = litCells(pct);
  return (
    <div className="flex h-1.5 flex-1 gap-0.5" aria-hidden>
      {Array.from({ length: 30 }, (_, i) => (
        <i
          key={i}
          className={cn("block flex-1 rounded-[1px] bg-foreground/8", i < lit && warn && "bg-amber")}
          style={i < lit && !warn ? { background: tint ?? "var(--ink)" } : undefined}
        />
      ))}
    </div>
  );
}

function WindowRow({ w, tint }: { w: LimitWindow; tint?: string }) {
  const warn = isWarn(w);
  return (
    <div className="flex items-center gap-3 text-xs text-ink3">
      <span className="w-[120px]">{w.label}</span>
      <Bar pct={w.usedPct} warn={warn} tint={tint} />
      <span className={cn("w-12 text-right tabular-nums", warn && "text-amber")}>{pctText(w)}</span>
    </div>
  );
}

/// A limit card's outline before its CLI has answered: the logo, a name and a
/// chip, then two tracks with their label and figure.
function LimitSkeleton() {
  return (
    <SkeletonRegion
      label="Reading the plan limits"
      className="mt-3 rounded-(--r3) bg-s1 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]"
    >
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-[18px] rounded-[5px]" />
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-4 w-10" />
        <Skeleton className="ml-auto h-3 w-32" />
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-[120px]" />
            <Skeleton className="h-1.5 flex-1 rounded-[1px]" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

function LimitCard({
  limits,
  defaults,
  reading,
  onPlan,
}: {
  limits: CliLimits;
  /// Re-read in flight with this card's last answer still on screen.
  reading: boolean;
  defaults: WorkspaceDefaults;
  onPlan: (harness: string, plan: string) => void;
}) {
  const reset = resetNote(limits.windows);
  const choices = PLAN_CHOICES[limits.harness];
  const measured = limits.source === "claude-usage" || limits.source === "codex-app-server";
  const needsPlan = choices && limits.installed && !measured;

  return (
    <div className="mt-3 rounded-(--r3) bg-s1 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-2.5">
        <AgentIcon harness={limits.harness as Harness} className="size-[18px]" />
        <b className="text-[13.5px] font-semibold text-ink">{CLI_NAME[limits.harness] ?? limits.harness}</b>
        {sourceNote(limits) && (
          <span className="rounded-[5px] bg-s3 px-1.5 py-px text-[11px] font-medium text-ink3">{sourceNote(limits)}</span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-ink3">
          {reading && <Spinner className="size-3" />}
          {limits.windows.length > 0 ? reset : (limits.note ?? "")}
        </span>
      </div>

      {limits.windows.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5">
          {limits.windows.map((w) => (
            <WindowRow key={w.key} w={w} tint={TINT[limits.harness]} />
          ))}
        </div>
      )}

      {limits.windows.length > 0 && limits.note && limits.source === "estimate" && (
        <p className="mt-2.5 text-xs text-ink4">{limits.note}</p>
      )}

      {needsPlan && (
        <div className="mt-3 flex items-center gap-2.5 text-xs text-ink3">
          <span>Your plan, for an estimate</span>
          <Segmented
            label={`${CLI_NAME[limits.harness]} plan`}
            value={defaults.plans[limits.harness] ?? ""}
            onChange={(plan) => onPlan(limits.harness, plan)}
            options={choices.map((p) => ({ value: p, label: p }))}
          />
        </div>
      )}
    </div>
  );
}

/// A US-dollar field that commits on blur and on Enter, and clears with nothing in it.
function MoneyField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null;
  onCommit: (n: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : usd(value));
  const commit = () => {
    const n = parseUsd(text);
    onCommit(n);
    setText(n === null ? "" : usd(n));
  };
  return (
    <input
      aria-label={label}
      value={text}
      placeholder="No limit"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={cn(fieldClassName, "w-[130px] px-2.5 py-1.5 font-mono")}
    />
  );
}

/// Settings → Usage & limits: how close each CLI is to its plan's limit, what the
/// agents spent this month, and the workspace's budget.
export default function UsageSettings({ onOpenAccess }: { onOpenAccess: (agentId: string) => void }) {
  const { active, setDefaults } = useWorkspaces();
  const { byCli, reading, anyReading, refresh } = useLimits(active?.id);
  const spend = useSpend(active?.id);
  const roster = useRoster();
  if (!active) return null;

  const d = active.defaults;
  const put = (patch: Partial<WorkspaceDefaults>) => void setDefaults(active.id, { ...d, ...patch });
  const top = Math.max(...(spend?.agents.map((a) => a.usd) ?? [0]), 0.0001);

  const exportCsv = async () => {
    const path = await save({ defaultPath: csvFileName(), filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return;
    try {
      const rows = await invoke<number>("usage_export_csv", { workspaceId: active.id, path });
      toast(`${rows} ${rows === 1 ? "call" : "calls"} saved`);
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <>
      <Lead>What your agents spend, and how close each CLI is to its plan's limit.</Lead>

      <div className="-mt-4 flex items-center justify-between">
        <span className="text-xs text-ink4">Read from each CLI. A bar marked ~ is hz's own estimate.</span>
        <Button variant="outline" size="sm" disabled={anyReading} onClick={() => void refresh()}>
          <RefreshCw className={cn(anyReading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="-mt-4">
        {CLI_ORDER.map((h) => {
          const l = byCli[h];
          return l ? (
            <LimitCard
              key={h}
              limits={l}
              defaults={d}
              reading={reading[h] === true}
              onPlan={(harness, plan) => put({ plans: { ...d.plans, [harness]: plan } })}
            />
          ) : (
            <LimitSkeleton key={h} />
          );
        })}
      </div>

      <SetHeading>{spend ? `Spend this month · ${usd(spend.totalUsd)}` : "Spend this month"}</SetHeading>
      <div className="flex flex-col gap-[9px]">
        {spend === null && (
          <SkeletonRegion label="Adding up this month" className="flex flex-col gap-[9px]">
            {[0.9, 0.55, 0.3].map((w, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-5 rounded-[6px]" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-2 rounded-[2px]" style={{ width: `${w * 60}%` }} />
                <Skeleton className="ml-auto h-3 w-[72px]" />
              </div>
            ))}
          </SkeletonRegion>
        )}
        {spend?.agents.length === 0 && <p className="text-xs text-ink3">Nothing spent yet this month.</p>}
        {spend?.agents.map((a) => {
          const agent = roster.agents.find((r) => r.id === a.agentId);
          return (
            <button
              key={a.agentId}
              type="button"
              onClick={() => onOpenAccess(a.agentId)}
              className="flex cursor-pointer items-center gap-2.5 rounded-(--r1) text-left text-[12.5px] text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {agent && <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={20} />}
              <span className="w-14 truncate">{a.name}</span>
              <span className="flex h-2 flex-1 gap-px overflow-hidden rounded-[2px]" aria-hidden>
                {Array.from({ length: 50 }, (_, i) => (
                  <i
                    key={i}
                    className="block h-full flex-1"
                    style={{ background: i < Math.round((a.usd / top) * 50) ? (agent?.color ?? "var(--ink)") : "var(--s3)" }}
                  />
                ))}
              </span>
              <span className="w-[76px] text-right text-xs text-ink2 tabular-nums">{usd(a.usd)}</span>
            </button>
          );
        })}
      </div>

      <SetHeading>Limits</SetHeading>
      <div>
        <StudioRow label="Workspace budget" hint="When the month reaches it.">
          <MoneyField label="Workspace budget" value={d.budgetUsd} onCommit={(budgetUsd) => put({ budgetUsd })} />
          <Segmented
            label="At the budget"
            value={d.budgetAction}
            onChange={(budgetAction) => put({ budgetAction })}
            options={[
              { value: "pause", label: "Pause agents" },
              { value: "ask", label: "Ask me" },
              { value: "go", label: "Keep going" },
            ]}
          />
        </StudioRow>
        <StudioRow label="Alert at" hint="A note in your Inbox and a banner, once a month.">
          <Segmented
            label="Alert at"
            value={String(d.alertPct)}
            onChange={(n) => put({ alertPct: Number(n) })}
            options={[50, 80, 95].map((n) => ({ value: String(n), label: `${n}%` }))}
          />
        </StudioRow>
        <StudioRow label="One task may cost at most" hint="Above this an agent stops and asks.">
          <MoneyField
            label="One task may cost at most"
            value={d.taskCapUsd}
            onCommit={(taskCapUsd) => put({ taskCapUsd })}
          />
        </StudioRow>
        <StudioRow label="Export" hint="Every call this month, with agent, CLI and cost.">
          <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
            <Download />
            Download CSV
          </Button>
        </StudioRow>
      </div>
    </>
  );
}
