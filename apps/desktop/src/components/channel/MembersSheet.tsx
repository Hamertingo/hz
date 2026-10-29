import AgentAvatar from "@/components/AgentAvatar";
import { Group, Row, Section } from "@/components/kit/kit";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { RosterAgent } from "@/lib/roster";
import type { Channel } from "@/types/events";

/// Who is in a channel, who leads it and how many rounds a message may run. Each
/// change is written as it is made; Done only closes.
export default function MembersSheet({
  open,
  onOpenChange,
  channel,
  agents,
  workspaceName,
  onMember,
  onLead,
  onRounds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel;
  /// Every agent of the workspace, in the roster's order.
  agents: RosterAgent[];
  workspaceName: string;
  onMember: (agentId: string, member: boolean) => void;
  onLead: (agentId: string) => void;
  onRounds: (rounds: number) => void;
}) {
  const inside = agents.filter((a) => channel.members.includes(a.id));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width={420}
      title={`#${channel.name} members`}
      sub={`${inside.length} ${inside.length === 1 ? "agent" : "agents"} and you`}
      footer={
        <Button className="ml-auto" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <Section title={`Agents in ${workspaceName}`} className="mt-0" />
      <Group>
        {agents.map((a) => {
          const on = channel.members.includes(a.id);
          const only = on && channel.members.length === 1;
          return (
            <Row
              key={a.id}
              lead={<AgentAvatar agent={a} size={28} />}
              title={a.name}
              sub={`${a.role}${a.id === channel.lead ? " · lead" : ""}`}
              right={
                <Switch
                  checked={on}
                  disabled={only}
                  aria-label={`${a.name} in #${channel.name}`}
                  onCheckedChange={(next) => onMember(a.id, next)}
                />
              }
            />
          );
        })}
      </Group>
      <Section title="Lead" />
      <Segmented
        label="Lead"
        value={channel.lead}
        onChange={onLead}
        options={inside.map((a) => ({ value: a.id, label: a.name }))}
      />
      <Section title="Rounds per message" />
      <Segmented
        label="Rounds per message"
        value={String(channel.rounds)}
        onChange={(v) => onRounds(Number(v))}
        options={["1", "2", "3"].map((n) => ({ value: n, label: n }))}
      />
    </Sheet>
  );
}
