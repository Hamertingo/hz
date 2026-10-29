import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";

import AgentIcon from "@/components/AgentIcon";
import AgentTile from "@/components/AgentTile";
import { Empty, Group, Row, Val } from "@/components/kit/kit";
import { SetHeading, StudioRow } from "@/components/settings/StudioRow";
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
  parseUsd,
  pctText,
  untilReset,
  sourceNote,
  usd,
} from "@/lib/limits";
import { compactTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CliLimits, Harness, LimitWindow, WorkspaceDefaults } from "@/types/events";

const CLI_NAME: Record<string, string> = { "claude-acp": "Claude Code", "codex-acp": "Codex", opencode: "OpenCode" };

/// The plans hz can size an estimate for, by CLI.
const PLAN_CHOICES: Record<string, string[]> = { "claude-acp": ["Pro", "Max"], "codex-acp": ["Plus", "Pro"] };

function Meter({ pct, warn }: { pct: number | null; warn: boolean }) {
  return (
    <div className="mt-1.5 h-[5px] w-full overflow-hidden rounded-[9px] bg-s3" aria-hidden>
      <i className={cn("block h-full rounded-[9px] bg-ink2", warn && "bg-amber")} style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
    </div>
  );
}

/// "resets in 2h 10m" inside a day, "resets Monday" past it; empty when the CLI named none.
function windowReset(w: LimitWindow): string {
  if (w.resetsAtMs === null || w.resetsAtMs <= Date.now()) return "";
  const left = untilReset(w.resetsAtMs);
  if (left && w.resetsAtMs - Date.now() < 24 * 3_600_000) return `resets in ${left}`;
  return `resets ${new Date(w.resetsAtMs).toLocaleDateString("en-US", { weekday: "long" })}`;
}

function WindowRow({ w }: { w: LimitWindow }) {
  const warn = isWarn(w);
  const reset = windowReset(w);
  return (
    <>
      <div className="mt-[11px] flex text-xs leading-normal text-ink2">
        <span>{w.label}</span>
        <span className="ml-auto text-ink3">{reset ? `${reset} · ${pctText(w)}` : pctText(w)}</span>
      </div>
      <Meter pct={w.usedPct} warn={warn} />
    </>
  );
}

/// A limit card's outline before its CLI has answered: the logo, a name and a
/// chip, then two tracks with their label and figure.
function LimitSkeleton() {
  return (
    <SkeletonRegion
      label="Reading the plan limits"
      className="relative px-3.5 py-3.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-line"
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
  const choices = PLAN_CHOICES[limits.harness];
  const measured = limits.source === "claude-usage" || limits.source === "codex-app-server";
  const needsPlan = choices && limits.installed && !measured;

  return (
    <div className="relative px-3.5 py-3.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-line">
      <div className="flex items-center gap-2.5">
        <span className="grid size-6 place-items-center text-ink2">
          <AgentIcon harness={limits.harness as Harness} className="size-[18px]" />
        </span>
        <b className="text-[13px] font-[650] text-ink">{CLI_NAME[limits.harness] ?? limits.harness}</b>
        {sourceNote(limits) && (
          <span className="rounded-[5px] bg-s3 px-1.5 py-px text-[11px] font-medium text-ink3">{sourceNote(limits)}</span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-ink3">
          {reading && <Spinner className="size-3" />}
          {limits.windows.length > 0 ? "" : (limits.note ?? "")}
        </span>
      </div>

      {limits.windows.map((w) => (
        <WindowRow key={w.key} w={w} />
      ))}

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
      <Group>
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
      </Group>

      <div className="mx-1 mt-3 flex items-center gap-1.5">
        <b className="text-xs font-medium text-ink3">Spend this month</b>
        {spend && <i className="text-xs not-italic text-ink4">{usd(spend.totalUsd)}</i>}
        <button
          type="button"
          disabled={anyReading}
          onClick={() => void refresh()}
          className="ml-auto flex cursor-pointer items-center gap-1 rounded-md px-[7px] py-px text-xs font-medium text-ink2 transition-colors hover:bg-s2 hover:text-ink disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", anyReading && "animate-spin")} />
          Refresh limits
        </button>
      </div>
      <Group>
        {spend === null && (
          <SkeletonRegion label="Adding up this month" className="flex flex-col gap-[9px] px-3 py-3">
            {[0.9, 0.55, 0.3].map((w, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-[26px] rounded-[8px]" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="ml-auto h-3 w-[72px]" style={{ opacity: w }} />
              </div>
            ))}
          </SkeletonRegion>
        )}
        {spend?.agents.length === 0 && <Empty>Nothing spent yet this month.</Empty>}
        {spend?.agents.map((a) => {
          const agent = roster.agents.find((r) => r.id === a.agentId);
          return (
            <Row
              key={a.agentId}
              bareLead={!!agent}
              lead={agent ? <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} size={26} /> : undefined}
              title={a.name}
              sub={
                <>
                  <span className="block text-xs text-ink3">
                    {`${compactTokens(a.inputTokens + a.outputTokens)} tokens · ${a.calls} ${a.calls === 1 ? "run" : "runs"}`}
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-[9px] bg-s3" aria-hidden>
                    <i className="block h-full rounded-[9px] bg-ink2" style={{ width: `${Math.min(100, (a.usd / top) * 100)}%` }} />
                  </span>
                </>
              }
              onClick={() => onOpenAccess(a.agentId)}
              right={<Val>{`$${a.usd.toFixed(2)}`}</Val>}
            />
          );
        })}
      </Group>

      <p className="mx-1 mt-1.5 text-xs leading-normal text-ink4">
        What each engine reports. Where it names no price, the cost is estimated from its tokens.
      </p>

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
