import { RefreshCw, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import Dither from "@/components/Dither";
import { Chip, Empty, Group, Row, Section, Val } from "@/components/kit/kit";
import MeAvatar from "@/components/MeAvatar";
import { liftDark, PluginMark } from "@/components/plugins/parts";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { POLICIES, POLICY_LABEL } from "@/lib/pluginsView";
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
        width={600}
        bare
        expandable={false}
        title={p.name}
        footer={
          <>
            <Button variant="bad" className="mr-auto" onClick={() => setConfirm(true)}>
              {p.kind === "custom" ? "Remove" : "Disconnect"}
            </Button>
            <Button variant="solid" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="relative h-24 overflow-hidden bg-s2">
          <Dither color={liftDark(p.color)} seed={`${p.id}:drawer`} cols={150} rows={24} light={0.8} />
        </div>
        <span className="relative z-[2] -mt-[30px] ml-5 flex w-max rounded-(--r4) bg-(--sheet) p-[5px]">
          <PluginMark face={p} size={60} />
        </span>
        <div className="flex items-center gap-2.5 px-5 pt-2">
          <h2 className="flex-1 text-lg font-semibold tracking-[-0.015em]">{p.name}</h2>
          <Chip dot={p.status === "connected" ? "go" : "warn"}>{p.status === "connected" ? "Connected" : "Needs attention"}</Chip>
        </div>
        <div className="px-5 pt-1 pb-5">
          <p className="mx-0.5 mt-1.5 mb-1 text-[13px] leading-normal text-ink2">{p.description}</p>
          {p.error && <p className="mx-0.5 mt-1 text-xs leading-normal text-red">{p.error}</p>}

          <Section title="Which agents can use it" count={mine.length} />
          <Group>
            {agents.map((a) => (
              <Row
                key={a.id}
                bareLead
                lead={<AgentTile id={a.id} kind={a.kind} color={a.color} shape={a.shape} look={a.look} photo={a.photo} size={26} />}
                title={a.name}
                sub={a.role}
                right={<Switch aria-label={`${a.name} can use it`} checked={p.grants.includes(a.id)} onCheckedChange={(on) => onGrant(p, a, on)} />}
              />
            ))}
            {agents.length === 0 && <Empty>There are no agents in this workspace yet.</Empty>}
          </Group>
          <p className="mx-1 mt-1.5 text-xs leading-normal text-ink4">
            A new grant reaches an agent when its next session starts. A taken one stops working at once.
          </p>

          <Section
            title="What it may do"
            action={busy === "refresh" ? "Listing…" : "Refresh list"}
            onAction={() => busy === null && void run("refresh", onRefresh)}
          />
          <Group>
            {p.tools.map((t) => (
              <Row
                key={t.name}
                lead={<Zap />}
                title={t.name}
                sub={t.description || undefined}
                right={
                  <Segmented<Policy>
                    label={`${t.name} policy`}
                    value={t.policy}
                    onChange={(policy) => onPolicy(p, t.name, policy)}
                    options={POLICIES.map((x) => ({ value: x, label: POLICY_LABEL[x] }))}
                  />
                }
              />
            ))}
            {p.tools.length === 0 && (
              <Empty>No tools listed yet. Refresh the list to ask the server what it offers.</Empty>
            )}
          </Group>

          <Section title="Connection" />
          <Group>
            <Row
              bareLead
              lead={<MeAvatar me={me} size={26} />}
              title={p.account ?? (p.transport.kind === "stdio" ? "Runs on this Mac" : "No account")}
              sub={`${p.connectedAt ? `Connected ${connectedOn(p.connectedAt)}` : "Added by you"} · ${connectionLine(p)}`}
              right={
                <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run("reconnect", onReconnect)}>
                  {busy === "reconnect" ? <Spinner className="size-3.5" /> : <RefreshCw className="size-[13px]" />}
                  {busy === "reconnect" ? "Reconnecting" : "Reconnect"}
                </Button>
              }
            />
          </Group>

          <Section title="Recent calls" count={callsThisWeek(calls, p.id, now) ? `${callsThisWeek(calls, p.id, now)} this week` : undefined} />
          {log.length === 0 ? (
            <p className="mx-1 text-[12.5px] text-ink3">No calls yet.</p>
          ) : (
            <Group>
              {log.map((c) => {
                const a = agents.find((x) => x.id === c.agent);
                const note = outcomeLabel(c.outcome);
                return (
                  <Row
                    key={`${c.t}-${c.tool}`}
                    bareLead={!!a}
                    lead={a ? <AgentTile id={a.id} kind={a.kind} color={a.color} shape={a.shape} look={a.look} photo={a.photo} size={20} /> : undefined}
                    title={<code className={cn("font-mono text-xs", c.ok ? "text-ink2" : "text-red")}>{c.tool}</code>}
                    sub={`${clockOf(c.t)} · ${a?.name ?? c.agent}${note ? ` · ${note}` : ""}`}
                    right={<Val>{durationOf(c.ms)}</Val>}
                  />
                );
              })}
            </Group>
          )}
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
