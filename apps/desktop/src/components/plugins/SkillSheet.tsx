import { BookOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AgentSwitchRow, H4 } from "@/components/plugins/parts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fieldClassName } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import Spinner from "@/components/ui/spinner";
import { NEW_SKILL_MD } from "@/lib/pluginsView";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Skill, SkillInput } from "@/types/events";

/// The Skill editor: a name, the `SKILL.md` text and which agents are told about
/// it. `skill` is null for a new one. The file is written where an agent can open
/// it with its own tools, and its path is shown so that is not a secret.
export default function SkillSheet({
  open,
  skill,
  agents,
  by,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  skill: Skill | null;
  agents: RosterAgent[];
  /// The author's name, for the line under the title.
  by: string;
  onClose: () => void;
  onSave: (input: SkillInput) => Promise<boolean>;
  onDelete: (skill: Skill) => void;
}) {
  const [name, setName] = useState("");
  const [md, setMd] = useState("");
  const [grants, setGrants] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(skill?.name ?? "");
    setMd(skill?.md ?? NEW_SKILL_MD);
    setGrants(skill?.grants ?? []);
    setConfirm(false);
  }, [open, skill]);

  const save = async () => {
    setSaving(true);
    const ok = await onSave({ slug: skill?.slug, name, md, grants });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => !o && onClose()}
        mode="centered"
        width={760}
        title={skill ? skill.name : "New skill"}
        sub={skill ? `SKILL.md · by ${by}` : "A how-to any agent can follow"}
        icon={
          <span className="grid size-[30px] place-items-center rounded-(--r2) bg-s3 text-ink2">
            <BookOpen className="size-4" />
          </span>
        }
        footer={
          <>
            {skill && (
              <Button variant="bad" onClick={() => setConfirm(true)}>
                <Trash2 className="size-[11px]" /> Delete
              </Button>
            )}
            <Button variant="outline" className="ml-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="solid" disabled={saving} onClick={() => void save()}>
              {saving && <Spinner className="size-3.5" />}
              {skill ? "Save" : "Create skill"}
            </Button>
          </>
        }
      >
        <H4>Name</H4>
        <input
          className={fieldClassName}
          placeholder="Customer email in our voice"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <H4>SKILL.md</H4>
        <textarea
          className={cn(fieldClassName, "h-[300px] resize-none font-mono text-xs leading-[1.7]")}
          value={md}
          spellCheck={false}
          onChange={(e) => setMd(e.target.value)}
        />
        {skill && <p className="mt-1.5 truncate font-mono text-[11px] text-ink4">{skill.path}</p>}
        <H4>Which agents can use it</H4>
        {agents.map((a) => (
          <AgentSwitchRow
            key={a.id}
            agent={a}
            size={26}
            on={grants.includes(a.id)}
            onChange={(on) => setGrants((g) => (on ? [...g, a.id] : g.filter((x) => x !== a.id)))}
          />
        ))}
        <p className="mt-1.5 text-xs leading-normal text-ink4">
          An agent is told about a skill, and where its file is, in its instructions from its next message. It opens the file when a task fits.
        </p>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${skill?.name ?? "this skill"}?`}
        description="Agents that use it stop being told about it on their next message. The file is deleted."
        confirmLabel="Delete skill"
        onConfirm={() => {
          if (skill) onDelete(skill);
        }}
      />
    </>
  );
}
