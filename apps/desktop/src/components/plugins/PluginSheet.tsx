import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import { AccountBox, AgentSwitchRow, H4, PluginBand, ToolRow } from "@/components/plugins/parts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet } from "@/components/ui/sheet";
import Spinner from "@/components/ui/spinner";
import {
  callsThisWeek,
  clockOf,
  connectedOn,
  connectionLine,
  durationOf,
  holders,
  outcomeLabel,
  recentCalls,
} from "@/lib/pluginsView";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { CallRecord, Me, Plugin, Policy } from "@/types/events";

/// One connected plugin, centered and without a header of its own: the banner in
/// its colour, who it is signed in as, every tool with its Allow / Ask / Off,
/// which agents hold it and what they last did with it.
///
/// Every edit is written at once, so there is no Save: Done only closes.
export default function PluginSheet({
  plugin,
  agents,
  calls,
  me,
  now,
  onClose,
  onPolicy,
  onGrant,
  onReconnect,
  onRefresh,
  onDisconnect,
}: {
  plugin: Plugin | null;
  agents: RosterAgent[];
  calls: CallRecord[];
  me: Me;
  now: number;
  onClose: () => void;
  onPolicy: (plugin: Plugin, tool: string, policy: Policy) => void;
  onGrant: (plugin: Plugin, agent: RosterAgent, on: boolean) => void;
  onReconnect: (plugin: Plugin) => Promise<void>;
  onRefresh: (plugin: Plugin) => Promise<void>;
  onDisconnect: (plugin: Plugin) => void;
}) {
  // The last plugin stays drawn while the sheet fades out, so closing does not blank it.
  const last = useRef<Plugin | null>(null);
  if (plugin) last.current = plugin;
  const p = plugin ?? last.current;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"reconnect" | "refresh" | null>(null);
  useEffect(() => {
    if (!plugin) setConfirm(false);
  }, [plugin]);

  if (!p) return null;
  const mine = holders(p, agents);
  const log = recentCalls(calls, p.id);
  const run = async (kind: "reconnect" | "refresh", fn: (p: Plugin) => Promise<void>) => {
    setBusy(kind);
    try {
      await fn(p);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Sheet
        open={!!plugin}
        onOpenChange={(o) => !o && onClose()}
        mode="centered"
        width={880}
        bare
        title={p.name}
        footer={
          <>
            <Button variant="bad" onClick={() => setConfirm(true)}>
              {p.kind === "custom" ? "Remove" : "Disconnect"}
            </Button>
            <Button variant="solid" className="ml-auto" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <PluginBand face={p} color={p.color} height={120} markSize={76} />
        <div className="mt-[52px] grid grid-cols-[260px_1fr] gap-9 px-6 pb-7 max-[760px]:grid-cols-1">
          <div className="flex flex-col gap-3.5">
            <div>
              <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{p.name}</h2>
              <span className="mt-1 flex items-center gap-[7px] text-xs text-ink3">
                <i className={cn("size-1.5 rounded-full", p.status === "connected" ? "bg-green" : "bg-amber")} />
                {connectionLine(p)}
              </span>
            </div>
            <p className="leading-[1.55] text-ink3">{p.description}</p>
            {p.error && <p className="text-xs leading-normal text-red">{p.error}</p>}
            <AccountBox
              me={me}
              title={p.account ?? (p.transport.kind === "stdio" ? "Runs on this Mac" : "No account")}
              sub={p.connectedAt ? `Connected ${connectedOn(p.connectedAt)}` : "Added by you"}
            />
            <Button variant="outline" disabled={busy !== null} onClick={() => void run("reconnect", onReconnect)}>
              {busy === "reconnect" ? <Spinner className="size-3.5" /> : <RefreshCw className="size-[13px]" />}
              {busy === "reconnect" ? "Reconnecting" : "Reconnect"}
            </Button>
            <div className="mt-1 flex flex-col gap-2 text-[12.5px]">
              {(
                [
                  ["Calls this week", callsThisWeek(calls, p.id, now)],
                  ["Tools", p.tools.length],
                  ["Agents", mine.length],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between text-ink3">
                  {label}
                  <b className="font-medium text-ink2">{value}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <H4
              right={
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void run("refresh", onRefresh)}
                    className="mr-3 cursor-pointer text-ink3 transition-colors hover:text-ink disabled:opacity-50"
                  >
                    {busy === "refresh" ? "Listing…" : "Refresh list"}
                  </button>
                  Allow · Ask you first · Off
                </>
              }
            >
              Tools
            </H4>
            {p.tools.length === 0 && (
              <p className="text-[12.5px] text-ink3">
                No tools listed yet. Refresh the list to ask the server what it offers.
              </p>
            )}
            {p.tools.map((t) => (
              <ToolRow
                key={t.name}
                name={t.name}
                description={t.description}
                policy={t.policy}
                onChange={(policy) => onPolicy(p, t.name, policy)}
              />
            ))}

            <H4>Which agents can use it</H4>
            {agents.map((a) => (
              <AgentSwitchRow key={a.id} agent={a} on={p.grants.includes(a.id)} onChange={(on) => onGrant(p, a, on)} />
            ))}
            <p className="mt-1.5 text-xs leading-normal text-ink4">
              A new grant reaches an agent when its next session starts. A taken one stops working at once.
            </p>

            <H4>Recent calls</H4>
            {log.length === 0 ? (
              <p className="text-[12.5px] text-ink3">No calls yet.</p>
            ) : (
              <div className="text-xs leading-8 text-ink3">
                {log.map((c) => {
                  const a = agents.find((x) => x.id === c.agent);
                  const note = outcomeLabel(c.outcome);
                  return (
                    <div key={`${c.t}-${c.tool}`} className="flex items-center gap-3">
                      <b className="w-10 font-normal text-ink4 tabular-nums">{clockOf(c.t)}</b>
                      <span className="flex w-[84px] items-center gap-1.5">
                        {a && <AgentTile id={a.id} kind={a.kind} color={a.color} size={16} />}
                        <span className="truncate">{a?.name ?? c.agent}</span>
                      </span>
                      <code className={cn("min-w-0 flex-1 truncate font-mono text-[11.5px]", c.ok ? "text-ink2" : "text-red")}>
                        {c.tool}
                        {note && <span className="ml-2 font-sans text-ink4">{note}</span>}
                      </code>
                      <span className="tabular-nums">{durationOf(c.ms)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`${p.kind === "custom" ? "Remove" : "Disconnect"} ${p.name}?`}
        description={`${mine.length} agent${mine.length === 1 ? "" : "s"} lose${mine.length === 1 ? "s" : ""} it at once. hz deletes what it kept for it from your Keychain.`}
        confirmLabel={p.kind === "custom" ? "Remove" : "Disconnect"}
        onConfirm={() => onDisconnect(p)}
      />
    </>
  );
}
