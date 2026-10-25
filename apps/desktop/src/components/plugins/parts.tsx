import { AppWindow } from "lucide-react";
import type { ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import BrandMark from "@/components/BrandMark";
import Dither from "@/components/Dither";
import MeAvatar from "@/components/MeAvatar";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { BRANDS } from "@/lib/brands";
import { POLICIES, POLICY_LABEL } from "@/lib/pluginsView";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Me, Policy } from "@/types/events";

/// What a plugin or a catalog entry needs to draw its face.
export type Face = { id: string; slug: string | null; mark: string };

/// A plugin's face: its real brand mark when it has one, a window glyph for the
/// browser and the initials of a server the reader added.
export function PluginMark({ face, size = 28 }: { face: Face; size?: number }) {
  if (face.slug && face.slug in BRANDS) return <BrandMark slug={face.slug} size={size} />;
  return (
    <span
      className="inline-grid shrink-0 place-items-center bg-(--paper) text-[#2f2f2d] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      {face.id === "browser" ? (
        <AppWindow style={{ width: Math.round(size * 0.56), height: Math.round(size * 0.56) }} strokeWidth={1.8} />
      ) : (
        <span className="font-[650]" style={{ fontSize: Math.round(size * 0.36) }}>
          {face.mark}
        </span>
      )}
    </span>
  );
}

/// The dithered band in a plugin's colour, with its mark sitting on the edge.
/// `sheet` is the tall one on the detail; the modal's is shorter.
export function PluginBand({ face, color, height, markSize, className }: { face: Face; color: string; height: number; markSize: number; className?: string }) {
  return (
    <div className={cn("relative border-b border-line", className)} style={{ height }}>
      <div className="absolute inset-0 overflow-hidden">
        <Dither color={color} seed={`${face.id}:band`} cols={120} rows={Math.round(height / 4)} light={0.8} />
      </div>
      <span
        className="absolute flex bg-(--pop)"
        style={{ left: markSize > 60 ? 24 : 22, bottom: -Math.round(markSize / 2 + 2), padding: markSize > 60 ? 6 : 5, borderRadius: markSize > 60 ? 26 : 20 }}
      >
        <PluginMark face={face} size={markSize} />
      </span>
    </div>
  );
}

/// Overlapping faces, the way the mockup stacks the agents that use something.
export function Faces({ agents, size = 18 }: { agents: readonly RosterAgent[]; size?: number }) {
  return (
    <span className="flex">
      {agents.map((a, i) => (
        <span key={a.id} className={cn("flex rounded-[6px] shadow-[0_0_0_2px_var(--pop)]", i > 0 && "-ml-[5px]")}>
          <AgentTile id={a.id} kind={a.kind} color={a.color} size={size} />
        </span>
      ))}
    </span>
  );
}

/// One agent with a switch: the row of "who can use it".
export function AgentSwitchRow({
  agent,
  size = 28,
  on,
  onChange,
}: {
  agent: RosterAgent;
  size?: number;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={size} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{agent.name}</div>
        <div className="truncate text-xs text-ink3">{agent.role}</div>
      </div>
      <Switch className="ml-auto" checked={on} aria-label={`${agent.name} can use it`} onCheckedChange={onChange} />
    </div>
  );
}

/// A tool and its Allow / Ask / Off choice.
export function ToolRow({ name, description, policy, onChange }: { name: string; description?: string | null; policy: Policy; onChange: (p: Policy) => void }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-line py-[9px] text-[12.5px] first:border-t-0">
      <div className="min-w-0">
        <code className="font-mono text-xs">{name}</code>
        {description && <div className="max-w-[360px] truncate text-[11.5px] text-ink4">{description}</div>}
      </div>
      <Segmented<Policy>
        className="ml-auto"
        label={`${name} policy`}
        value={policy}
        onChange={onChange}
        options={POLICIES.map((p) => ({ value: p, label: POLICY_LABEL[p] }))}
      />
    </div>
  );
}

/// The reader as a small tile with a line beside it.
export function AccountBox({ me, title, sub, size = 28, children }: { me: Me; title: ReactNode; sub: ReactNode; size?: number; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-(--r3) bg-s1 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
      <MeAvatar me={me} size={size} />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="truncate">{title}</div>
        <div className="mt-px text-xs text-ink3">{sub}</div>
      </div>
      {children}
    </div>
  );
}

/// The small grey heading over a block of a sheet.
export function H4({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <h4 className="mt-6 mb-2.5 flex items-center text-xs font-medium text-ink3 first:mt-0">
      {children}
      {right && <span className="ml-auto font-normal text-ink4">{right}</span>}
    </h4>
  );
}
