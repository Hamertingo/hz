import { CreditCard, KeyRound, SquareTerminal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Group, Row, Section, Val } from "@/components/kit/kit";
import { StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { kit } from "@/lib/kit";
import type { CommandReview, RosterAgent } from "@/lib/roster";

/// The three ways Mac commands get approved. Whatever the choice, a short list of risky commands
/// (deleting the disk, force-pushing main, reading the keychain…) always asks.
export const REVIEW_COPY: Record<CommandReview, { label: string; hint: string }> = {
  always_ask: { label: "Always ask", hint: "Every command on your Mac waits for your OK." },
  auto_review: { label: "Auto review", hint: "Commands that only read run on their own; the rest ask." },
  allow_all: { label: "Allow all", hint: "Commands run without asking, except the risky few that always do." },
};
const REVIEWS = Object.keys(REVIEW_COPY) as CommandReview[];

type Limits = { enabled: boolean; per_purchase_cents: number; per_month_cents: number; agents: string[] };

/// Settings → Agents: the mode an agent gets until its own Access tab says otherwise.
export function CommandReviewDefault() {
  const [mode, setMode] = useState<CommandReview | null>(null);
  useEffect(() => {
    let live = true;
    kit.reviewDefault().then((m) => live && setMode(m), () => {});
    return () => {
      live = false;
    };
  }, []);
  if (!mode) return null;
  return (
    <StudioRow label="Commands on your Mac" hint={`${REVIEW_COPY[mode].hint} Each agent can change it in its Access tab.`}>
      <Segmented
        label="Commands on your Mac"
        value={mode}
        onChange={(next) => {
          setMode(next);
          kit.reviewDefaultSet(next).catch((e) => toast(String(e)));
        }}
        options={REVIEWS.map((m) => ({ value: m, label: REVIEW_COPY[m].label }))}
      />
    </StudioRow>
  );
}

/// An agent's Access rows for safety: how its Mac commands are approved, the keys it was given, and whether it may buy.
export function AgentSafetyRows({ agent, onChange }: { agent: RosterAgent; onChange: (next: RosterAgent) => void }) {
  const [fallback, setFallback] = useState<CommandReview>("auto_review");
  const [keys, setKeys] = useState<string[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);

  const loadKeys = useCallback(() => {
    kit.keys(agent.id).then(setKeys, () => setKeys([]));
  }, [agent.id]);

  useEffect(() => {
    let live = true;
    kit.reviewDefault().then((m) => live && setFallback(m), () => {});
    kit.payments().then((p) => live && setLimits(p.limits), () => {});
    loadKeys();
    return () => {
      live = false;
    };
  }, [loadKeys]);

  const mode = agent.commandReview ?? fallback;
  const mayBuy = limits?.agents.includes(agent.id) ?? false;
  const setBuy = (on: boolean) => {
    if (!limits) return;
    const next = { ...limits, agents: on ? [...limits.agents.filter((a) => a !== agent.id), agent.id] : limits.agents.filter((a) => a !== agent.id) };
    setLimits(next);
    kit.paymentsSet(next).catch((e) => toast(String(e)));
  };

  return (
    <>
      <Section title="Safety" />
      <Group>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="w-full text-left">
              <Row
                lead={<SquareTerminal />}
                title={`Commands on your Mac: ${REVIEW_COPY[mode].label}`}
                sub={agent.commandReview ? REVIEW_COPY[mode].hint : `${REVIEW_COPY[mode].hint} The default, from Settings.`}
                right={<Val kind="down">Change</Val>}
                className="hover:bg-s2"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">Commands on your Mac</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={agent.commandReview ?? "default"}
              onValueChange={(v) => onChange({ ...agent, commandReview: v === "default" ? undefined : (v as CommandReview) })}
            >
              <DropdownMenuRadioItem value="default">
                <span className="flex flex-col">
                  Use the default
                  <span className="text-[11.5px] font-normal text-ink4">{REVIEW_COPY[fallback].label}, from Settings</span>
                </span>
              </DropdownMenuRadioItem>
              {REVIEWS.map((m) => (
                <DropdownMenuRadioItem key={m} value={m}>
                  <span className="flex flex-col">
                    {REVIEW_COPY[m].label}
                    <span className="text-[11.5px] font-normal text-ink4">{REVIEW_COPY[m].hint}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {limits && (
          <Row
            lead={<CreditCard />}
            title="May buy within your limits"
            sub={limits.enabled ? "Anything over them asks you first. The limits are in Settings." : "Payments are off in Settings, so every purchase asks you."}
            right={<Switch checked={mayBuy} onCheckedChange={setBuy} aria-label={`${agent.name} may buy`} />}
          />
        )}
        {keys.map((name) => (
          <Row
            key={name}
            lead={<KeyRound />}
            title={<span className="font-mono text-[12.5px]">{name}</span>}
            sub="In the keychain. The agent only sees the name."
            right={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Forget ${name}`}
                onClick={() =>
                  void kit.keyRemove(agent.id, name).then(
                    () => {
                      toast(`${name} forgotten`);
                      loadKeys();
                    },
                    (e) => toast(String(e)),
                  )
                }
              >
                <Trash2 />
              </Button>
            }
          />
        ))}
        {keys.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-ink3">No keys yet. {agent.name} asks for one with a card when it needs it.</div>}
      </Group>
    </>
  );
}
