import SettingsSkeleton from "@/components/settings/SettingsSkeleton";
import { Dices, Plus, Upload, User } from "lucide-react";
import { useEffect, useState } from "react";

import MeAvatar from "@/components/MeAvatar";
import { Lead, StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fieldClassName } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import WorkspaceLogo from "@/components/WorkspaceLogo";
import { useMe } from "@/hooks/useMe";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { nextColor } from "@/lib/workspace";

/// Settings → Workspace: logo, name, the context every agent is briefed with,
/// members and deletion.
export default function WorkspaceSettings() {
  const { workspaces, active, update, remove, uploadLogo, clearLogo } = useWorkspaces();
  const me = useMe();
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
  const other = workspaces.find((w) => w.id !== active.id);
  const onlyOne = workspaces.length <= 1;

  return (
    <>
      <Lead>
        A workspace is a team of agents. {active.name}'s agents are not {other?.name ?? "another workspace"}'s.
      </Lead>

      <div className="-mt-4">
        <StudioRow label="Logo" hint="Shown on the switcher and at the top of every agent's briefing.">
          <div className="flex items-center gap-4">
            <WorkspaceLogo name={active.name} mark={active.mark} color={active.color} logo={active.logo} size={72} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void uploadLogo(active.id)}>
                <Upload />
                Upload image
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void clearLogo(active.id);
                  void update(active.id, { color: nextColor(active.color) });
                }}
              >
                <Dices />
                Generate
              </Button>
              {active.logo && (
                <Button variant="outline" onClick={() => void clearLogo(active.id)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        </StudioRow>

        <StudioRow label="Name">
          <input
            aria-label="Workspace name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              void update(active.id, { name: e.target.value });
            }}
            className={fieldClassName}
          />
        </StudioRow>

        <StudioRow label="Context" hint="Goes before every agent's own instructions, in every conversation.">
          <textarea
            aria-label="Context"
            value={context}
            placeholder="What this team works on, the stack, who the customers are."
            onChange={(e) => {
              setContext(e.target.value);
              void update(active.id, { context: e.target.value });
            }}
            className={`${fieldClassName} h-24 resize-none leading-[1.55]`}
          />
        </StudioRow>

        <StudioRow label="Members" hint="People who can talk to these agents." column>
          <div className="flex items-center gap-2.5 py-1">
            <MeAvatar me={me} size={28} />
            <div>
              <div className="text-[13px] text-ink">{me.name}</div>
              <div className="text-[11.5px] text-ink3">Owner</div>
            </div>
          </div>
          {active.members.map((m) => (
            <div key={m.name} className="flex items-center gap-2.5 py-1">
              <span className="grid size-7 place-items-center rounded-lg border border-dashed border-line3 text-ink3">
                <User className="size-3" />
              </span>
              <div>
                <div className="text-[13px] text-ink">{m.name}</div>
                <div className="text-[11.5px] text-ink3">{m.pending ? "Invited · pending" : "Member"}</div>
              </div>
            </div>
          ))}
          <div>
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
          </div>
        </StudioRow>
      </div>

      <div className="flex items-center gap-4 rounded-(--r3) bg-red/[0.04] px-4 py-3.5 shadow-[inset_0_0_0_1px_rgb(230_120_122/14%)]">
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] font-[550] text-ink">Delete workspace</b>
          <span className="text-xs text-ink3">
            {onlyOne
              ? "It is your only workspace. Make another one first."
              : "Its agents and their memory go with it. Conversations stay on disk."}
          </span>
        </div>
        <Button variant="bad" disabled={onlyOne} onClick={() => setDeleting(true)}>
          Delete
        </Button>
      </div>

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
