import { useState } from "react";

import AgentTile from "@/components/AgentTile";
import BrandMark from "@/components/BrandMark";
import Dither from "@/components/Dither";
import { Chip, Empty, Group, Row, Section } from "@/components/kit/kit";
import { Faces } from "@/components/plugins/parts";
import { useIntegrations } from "@/components/settings/ConnectedSettings";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { kit } from "@/lib/kit";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

const COLOR = "#4285f4";
const LABEL: Record<string, string> = { gmail: "Gmail", calendar: "Calendar", drive: "Drive", organize: "Tidy Gmail" };

/// The person's Google account as a card among the connected plugins, and its sheet of which agents use
/// it. It is not a plugin (hz serves its tools itself, see `google_tools.rs`), so it reads its own state.
export function GoogleTile({ agents, card }: { agents: RosterAgent[]; card: string }) {
  const { state, reload } = useIntegrations();
  const [open, setOpen] = useState(false);
  const g = state?.google;
  if (!g?.connected) return null;
  const users = agents.filter((a) => g.agents.includes(a.id));

  const grant = async (a: RosterAgent, on: boolean) => {
    try {
      await kit.googleGrant(a.id, on);
      toast(on ? `${a.name} can use Google from its next session` : `${a.name} no longer uses Google`, { ms: 2200 });
    } catch (e) {
      toast(String(e));
    }
    reload();
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(true)}
        className={cn(card, "flex cursor-pointer flex-col overflow-hidden rounded-(--r3) bg-transparent transition-[background,box-shadow] outline-none hover:bg-s1 hover:shadow-[inset_0_0_0_1px_var(--line2)] focus-visible:ring-2 focus-visible:ring-ring/50")}
      >
        <div className="relative h-[52px] overflow-hidden bg-s2">
          <Dither color={COLOR} seed="google:band" cols={90} rows={20} light={0.8} />
        </div>
        <div className="flex flex-1 flex-col gap-[5px] px-3.5 pb-[13px]">
          <span className="relative z-[2] -mt-[19px] flex w-max rounded-[12px] bg-(--sheet) p-[3px]">
            <BrandMark slug="gmail" size={40} />
          </span>
          <div className="flex items-center gap-2">
            <b className="truncate text-[13.5px] font-semibold">Google</b>
            <span className="ml-auto inline-flex items-center gap-[5px] text-[11.5px] whitespace-nowrap text-ink3">
              <i className="size-1.5 rounded-full bg-green" />
              Connected
            </span>
          </div>
          <div className="flex-1 text-[12.5px] leading-normal text-ink3">
            {g.email} · {g.services.map((s) => LABEL[s] ?? s).join(", ")}
          </div>
          <div className="mt-[5px] flex items-center gap-2 text-[11.5px] leading-normal text-ink3">
            {users.length > 0 ? (
              <>
                <Faces agents={users} />
                <span>
                  {users.length} agent{users.length === 1 ? "" : "s"}
                </span>
              </>
            ) : (
              "Nobody uses it yet"
            )}
          </div>
        </div>
      </div>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        mode="centered"
        width={560}
        bare
        expandable={false}
        title="Google"
        footer={
          <Button variant="solid" onClick={() => setOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="relative h-24 overflow-hidden bg-s2">
          <Dither color={COLOR} seed="google:drawer" cols={150} rows={24} light={0.8} />
        </div>
        <span className="relative z-[2] -mt-[30px] ml-5 flex w-max rounded-(--r4) bg-(--sheet) p-[5px]">
          <BrandMark slug="gmail" size={60} />
        </span>
        <div className="flex items-center gap-2.5 px-5 pt-2">
          <h2 className="flex-1 text-lg font-semibold tracking-[-0.015em]">Google</h2>
          <Chip dot="go">{g.email ?? "Connected"}</Chip>
        </div>
        <div className="px-5 pt-1 pb-5">
          <p className="mx-0.5 mt-1.5 mb-1 text-[13px] leading-normal text-ink2">
            {g.services.map((s) => LABEL[s] ?? s).join(", ")}. Agents search and read, and write drafts you send yourself. A new
            calendar event and every bulk change to Gmail ask you first. Sign out or change what it covers in Settings → Privacy.
          </p>
          <Section title="Which agents can use it" count={users.length} />
          <Group>
            {agents.map((a) => (
              <Row
                key={a.id}
                bareLead
                lead={<AgentTile id={a.id} kind={a.kind} color={a.color} shape={a.shape} look={a.look} photo={a.photo} size={26} />}
                title={a.name}
                sub={a.role}
                right={<Switch aria-label={`${a.name} can use Google`} checked={g.agents.includes(a.id)} onCheckedChange={(on) => void grant(a, on)} />}
              />
            ))}
            {agents.length === 0 && <Empty>There are no agents in this workspace yet.</Empty>}
          </Group>
          <p className="mx-1 mt-1.5 text-xs leading-normal text-ink4">
            A new grant reaches an agent when its next session starts. A taken one stops working at its next call.
          </p>
        </div>
      </Sheet>
    </>
  );
}
