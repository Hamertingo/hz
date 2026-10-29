import { listen } from "@tauri-apps/api/event";
import { Repeat } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/kit/kit";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { kit, type RoutineOffer } from "@/lib/kit";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/// The once-only offer to make a routine of something the reader keeps asking for. hz notices the
/// repeat (`routine_suggest.rs`); a Yes or another time makes the routine through the routines backend,
/// and No is for good.
export default function RoutineOfferCard({ agent }: { agent: RosterAgent }) {
  const [offer, setOffer] = useState<RoutineOffer | null>(null);
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => kit.routineOffer(agent.id).then((o) => live && setOffer(o)).catch(() => {});
    void load();
    let off: (() => void) | undefined;
    void listen<{ agentId: string }>("routine_offer", ({ payload }) => payload.agentId === agent.id && void load()).then((fn) => {
      if (live) off = fn;
      else fn();
    });
    return () => {
      live = false;
      off?.();
    };
  }, [agent.id]);

  if (!offer) return null;

  const answer = async (a: "yes" | "time" | "no", at?: string) => {
    setBusy(true);
    try {
      const made = await kit.routineAnswer(agent.id, a, at);
      setOffer(null);
      toast(made ? `Routine made: ${agent.name} will do it on its own` : "Got it. hz won't offer this again.");
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon={<Repeat />}
      label="A routine?"
      foot={
        picking ? (
          <>
            <input
              type="time"
              aria-label="Time"
              autoFocus
              value={time || hhmm(offer.minuteOfDay)}
              onChange={(e) => setTime(e.target.value)}
              className={cn(fieldClassName, "w-[110px] px-2 py-1 font-mono text-xs")}
            />
            <Button variant="solid" size="sm" disabled={busy} onClick={() => void answer("time", time || hhmm(offer.minuteOfDay))}>
              Make it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button variant="solid" size="sm" disabled={busy} onClick={() => void answer("yes")}>
              Yes, at {hhmm(offer.minuteOfDay)}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPicking(true)}>
              Other time
            </Button>
            <span className="ml-auto">
              <Button variant="ghost" size="sm" disabled={busy} className="text-ink3" onClick={() => void answer("no")}>
                No, don't ask again
              </Button>
            </span>
          </>
        )
      }
    >
      <p className="text-[13.5px] leading-snug font-medium">{offer.line}</p>
      <p className="mt-0.5 text-[12.5px] leading-snug text-ink3">{agent.name} would do it on its own and post the result here.</p>
    </Card>
  );
}
