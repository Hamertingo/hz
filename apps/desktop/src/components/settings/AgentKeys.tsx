import { Key as KeyIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Empty, Group, Row } from "@/components/kit/kit";
import { SetHeading, StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fieldClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { kit } from "@/lib/kit";
import { cn } from "@/lib/utils";

type Limits = { enabled: boolean; per_purchase_cents: number; per_month_cents: number; agents: string[] };
type AppKey = { id: string; label: string; created: number; last_used: number | null };

const PER_PURCHASE = [1000, 2500, 5000, 10000];
const PER_MONTH = [5000, 10000, 25000, 50000];

const dollars = (cents: number) => `$${Math.round(cents / 100)}`;

/// The preset choices, plus the stored value when it is none of them, so a limit set some other way
/// still shows as the selected one.
function withCurrent(presets: number[], current: number) {
  return presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
}

/// What an agent may buy on its own: a switch and two ceilings. Read and written through the
/// agent kit; a build whose backend lacks the command shows the page without this block.
export function PaymentsRows() {
  const [limits, setLimits] = useState<Limits | null>(null);

  useEffect(() => {
    let live = true;
    kit.payments().then((p) => live && setLimits(p.limits), () => {});
    return () => {
      live = false;
    };
  }, []);

  if (!limits) return null;

  const save = (patch: Partial<Limits>) => {
    const next = { ...limits, ...patch };
    setLimits(next);
    kit.paymentsSet(next).catch((e) => toast(String(e)));
  };

  return (
    <>
      <SetHeading>Payments</SetHeading>
      <div>
        <StudioRow label="Agents may buy" hint="Lets an agent pay for something within the limits below. Anything over them asks you first.">
          <Switch aria-label="Agents may buy" checked={limits.enabled} onCheckedChange={(enabled) => save({ enabled })} />
        </StudioRow>
        <StudioRow label="Per purchase" hint="The most one purchase can cost.">
          <Segmented
            label="Per purchase"
            value={String(limits.per_purchase_cents)}
            onChange={(v) => save({ per_purchase_cents: Number(v) })}
            options={withCurrent(PER_PURCHASE, limits.per_purchase_cents).map((c) => ({ value: String(c), label: dollars(c) }))}
          />
        </StudioRow>
        <StudioRow label="Per month" hint="All agents together.">
          <Segmented
            label="Per month"
            value={String(limits.per_month_cents)}
            onChange={(v) => save({ per_month_cents: Number(v) })}
            options={withCurrent(PER_MONTH, limits.per_month_cents).map((c) => ({ value: String(c), label: dollars(c) }))}
          />
        </StudioRow>
      </div>
    </>
  );
}

/// The keys other apps use to read this one through its local API (who the agents are, their notes).
/// The secret is shown once, when it is made; the backend keeps only its hash. Times are Unix seconds.
export function KeysRows() {
  const [keys, setKeys] = useState<AppKey[] | null>(null);
  const [label, setLabel] = useState("");
  const [made, setMade] = useState<string | null>(null);

  const load = useCallback(() => {
    kit.appKeys().then(setKeys, () => setKeys(null));
  }, []);
  useEffect(load, [load]);

  if (keys === null) return null;

  const create = async () => {
    try {
      const k = await kit.appKeyCreate(label.trim() || "New key");
      setMade(k.key);
      setLabel("");
      load();
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <>
      <SetHeading>Connected apps</SetHeading>
      <Group>
        {keys.map((k) => (
          <Row
            key={k.id}
            lead={<KeyIcon className="text-amber" />}
            title={k.label}
            sub={`${k.last_used ? `Last used ${new Date(k.last_used * 1000).toLocaleString()}` : "Never used"} · made ${new Date(k.created * 1000).toLocaleDateString()}`}
            right={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Revoke ${k.label}`}
                onClick={() => void kit.appKeyRevoke(k.id).then(load, (e) => toast(String(e)))}
              >
                <Trash2 />
              </Button>
            }
          />
        ))}
        {keys.length === 0 && <Empty>No app can read hz yet. Make a key for one and paste it there.</Empty>}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <input
            aria-label="Key name"
            value={label}
            placeholder="Name, e.g. Zapier"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            className={cn(fieldClassName, "flex-1")}
          />
          <Button variant="outline" onClick={() => void create()}>
            New key
          </Button>
        </div>
      </Group>

      <Dialog open={made !== null} onOpenChange={(o) => !o && setMade(null)}>
        <DialogContent className="max-w-[440px] rounded-[18px]">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-semibold">Copy your key</DialogTitle>
            <DialogDescription>It is shown once. hz keeps only a hash of it.</DialogDescription>
          </DialogHeader>
          <div className="rounded-(--r3) bg-s2 px-4 py-4 font-mono text-[13px] break-all text-ink select-all">{made}</div>
          <div className="flex justify-end">
            <Button variant="solid" onClick={() => setMade(null)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
