import SettingsSkeleton from "@/components/settings/SettingsSkeleton";
import { Dices, Plus, Upload, User } from "lucide-react";
import { useEffect, useState } from "react";

import MeAvatar from "@/components/MeAvatar";
import AgentTile from "@/components/AgentTile";
import { Group, Row, Val } from "@/components/kit/kit";
import { Inline } from "@/components/settings/parts";
import { SetHeading } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fieldClassName } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import WorkspaceLogo from "@/components/WorkspaceLogo";
import { useMe } from "@/hooks/useMe";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { inWorkspace, useRoster } from "@/lib/roster";
import { nextColor } from "@/lib/workspace";

const ENGINE: Record<string, string> = { "claude-acp": "Claude Code", "codex-acp": "Codex", opencode: "OpenCode" };

/// Settings → Workspace: logo, name, the context every agent is briefed with,
/// members and deletion.
export default function WorkspaceSettings({ onOpenAgent }: { onOpenAgent?: (agentId: string) => void }) {
  const { workspaces, active, update, remove, uploadLogo, clearLogo } = useWorkspaces();
  const me = useMe();
  const roster = useRoster();
  const [name, setName] = useState(active?.name ?? "");
  const [context, setContext] = useState(active?.context ?? "");
  const [deleting, setDeleting] = useState(false);

  // Another workspace was switched to while this page was open.
  const id = active?.id;
  useEffect(() => {
    setName(active?.name ?? "");
    setContext(active?.context ?? "");
    // Only a switch resets the fields; a keystroke's own echo must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!active) return <SettingsSkeleton rows={4} />;
  const onlyOne = workspaces.length <= 1;

  const mine = roster.agents.filter((a) => inWorkspace(a, active.id));

  return (
    <>
      <Group className="mt-1">
        <Row
          bareLead
          lead={<WorkspaceLogo name={active.name} mark={active.mark} color={active.color} logo={active.logo} size={34} />}
          title="Name"
          right={
            <Inline
              aria-label="Workspace name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                void update(active.id, { name: e.target.value });
              }}
            />
          }
        />
        <Row
          title="Logo"
          sub="Shown on the switcher and at the top of every agent's briefing."
          right={
            <>
              <Button variant="outline" size="sm" onClick={() => void uploadLogo(active.id)}>
                <Upload />
                Upload image
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void clearLogo(active.id);
                  void update(active.id, { color: nextColor(active.color) });
                }}
              >
                <Dices />
                Generate
              </Button>
              {active.logo && (
                <Button variant="ghost" size="sm" onClick={() => void clearLogo(active.id)}>
                  Remove
                </Button>
              )}
            </>
          }
        />
        <div className="px-3 py-[9px]">
          <b className="block text-[13px] leading-[1.4] font-semibold">Context</b>
          <span className="mt-px mb-2 block text-[12.5px] leading-[1.45] text-ink3">
            What every agent in this workspace knows. Goes before each agent's own instructions.
          </span>
          <textarea
            aria-label="Context"
            value={context}
            placeholder="What this team works on, the stack, who the customers are."
            onChange={(e) => {
              setContext(e.target.value);
              void update(active.id, { context: e.target.value });
            }}
            className={`${fieldClassName} h-[78px] resize-none leading-[1.55]`}
          />
        </div>
      </Group>

      <SetHeading>Members</SetHeading>
      <Group>
        <Row bareLead lead={<MeAvatar me={me} size={26} />} title={me.name} sub="Owner" />
        {active.members.map((m) => (
          <Row
            key={m.name}
            lead={
              <span className="grid size-[26px] place-items-center rounded-lg border border-dashed border-line3 text-ink3">
                <User className="size-3" />
              </span>
            }
            title={m.name}
            sub={m.pending ? "Invited · pending" : "Member"}
          />
        ))}
        <Row
          title="Invite people"
          right={
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-block">
                  <Button variant="outline" size="sm" disabled>
                    <Plus />
                    Invite
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Coming with team sync</TooltipContent>
            </Tooltip>
          }
        />
      </Group>

      {mine.length > 0 && (
        <>
          <div className="mx-1 mt-3 flex items-baseline gap-1.5">
            <b className="text-xs font-medium text-ink3">In this workspace</b>
            <i className="text-xs not-italic text-ink4">{mine.length}</i>
          </div>
          <Group>
            {mine.map((a) => (
              <Row
                key={a.id}
                bareLead
                lead={<AgentTile id={a.id} kind={a.kind} color={a.color} shape={a.shape} look={a.look} photo={a.photo} size={26} />}
                title={a.name}
                sub={[a.role, ENGINE[a.harness]].filter(Boolean).join(" · ") || undefined}
                onClick={onOpenAgent ? () => onOpenAgent(a.id) : undefined}
                right={<Val kind="next" />}
              />
            ))}
          </Group>
        </>
      )}

      <SetHeading>Danger</SetHeading>
      <Group>
        <Row
          title="Delete this workspace"
          sub={
            onlyOne
              ? "It is your only workspace. Make another one first."
              : "Its agents and their memory go with it. Conversations stay on disk."
          }
          right={
            <Button variant="danger" disabled={onlyOne} onClick={() => setDeleting(true)}>
              Delete
            </Button>
          }
        />
      </Group>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${active.name}?`}
        description="Its agents and their memory go with it. Their conversations stay on disk."
        confirmLabel="Delete workspace"
        typeToConfirm={active.name}
        onConfirm={() => {
          const gone = active.name;
          void remove(active.id).then((ok) => ok && toast(`${gone} deleted`));
        }}
      />
    </>
  );
}
