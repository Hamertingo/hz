import AgentTile from "@/components/AgentTile";
import { Markdown } from "@/components/chat/Markdown";
import { StatusDot } from "@/components/channel/ChannelRows";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { clockTime, TASK_LABEL } from "@/lib/channels";
import type { RosterAgent } from "@/lib/roster";
import type { Channel, ChannelMessage, Task } from "@/types/events";

/// One task: where it stands, what happened to it and what came of it. The footer
/// is the way to the person doing it.
export default function TaskSheet({
  task,
  channel,
  owner,
  messages,
  onClose,
  onOpenOwner,
  onMessageOwner,
}: {
  task: Task | null;
  channel: Channel;
  owner: RosterAgent | undefined;
  messages: ChannelMessage[];
  onClose: () => void;
  onOpenOwner: (agentId: string) => void;
  onMessageOwner: (agentId: string) => void;
}) {
  // The words that started it: the reader's last message before the task was announced.
  const asked = task?.messageSeq
    ? [...messages].reverse().find((m) => m.from === "me" && m.seq < (task.messageSeq ?? 0))
    : undefined;
  const name = owner?.name ?? "The agent";

  return (
    <Sheet
      open={!!task}
      onOpenChange={(o) => !o && onClose()}
      width={460}
      title={task?.title ?? "Task"}
      sub={`Task in #${channel.name} · ${name} owns it`}
      icon={owner ? <AgentTile id={owner.id} kind={owner.kind} color={owner.color} size={30} /> : undefined}
      footer={
        owner && (
          <>
            <Button variant="outline" onClick={() => onOpenOwner(owner.id)}>
              Open {name}
            </Button>
            <Button className="ml-auto" onClick={() => onMessageOwner(owner.id)}>
              Message {name}
            </Button>
          </>
        )
      }
    >
      {task && (
        <>
          <h4 className="mb-2.5 text-xs font-medium text-ink3">Status</h4>
          <div className="flex items-center gap-2 text-[13px]">
            <StatusDot status={task.status} />
            {TASK_LABEL[task.status]}
          </div>

          <h4 className="mt-6 mb-2.5 text-xs font-medium text-ink3">Thread</h4>
          <ol className="flex flex-col gap-2.5 border-l border-line2 pl-3.5">
            {asked && (
              <li className="text-[13px]">
                You asked in #{channel.name}
                <span className="ml-2 text-[11.5px] text-ink4">{clockTime(asked.ts)}</span>
              </li>
            )}
            {task.steps.map((s) => (
              <li key={`${s.at}-${s.text}`} className="text-[13px]">
                {s.text}
                <span className="ml-2 text-[11.5px] text-ink4">{clockTime(s.at)}</span>
              </li>
            ))}
          </ol>

          {task.result && (
            <>
              <h4 className="mt-6 mb-2.5 text-xs font-medium text-ink3">Result</h4>
              <div className="rounded-(--r3) bg-s1 px-3.5 py-3 text-[13.5px] shadow-[inset_0_0_0_1px_var(--line)]">
                <Markdown>{task.result}</Markdown>
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
