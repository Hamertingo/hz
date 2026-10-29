import { AtSign, Bell, Globe, Upload, User } from "lucide-react";
import { useState } from "react";

import Dither from "@/components/Dither";
import MeAvatar from "@/components/MeAvatar";
import Mascot from "@/components/Mascot";
import { Group, Row } from "@/components/kit/kit";
import { SetHeading } from "@/components/settings/StudioRow";
import { Inline, Pick } from "@/components/settings/parts";
import Swatches from "@/components/Swatches";
import { Button } from "@/components/ui/button";
import { removePhoto, updateMe, uploadPhoto, useMe } from "@/hooks/useMe";
import { LANGUAGES, STATUSES, statusMeta } from "@/lib/me";
import { MASCOT_KINDS } from "@/lib/mascots";
import { cn } from "@/lib/utils";
import type { MeStatus } from "@/types/events";

/// Settings → Profile: how the reader appears to their agents and in every chat.
export default function ProfileSettings() {
  const me = useMe();
  // Typed into a local copy so a half-deleted name does not blink the sidebar
  // to "You" while it is empty; the store only takes a non-blank one.
  const [name, setName] = useState(me.name);
  const [calls, setCalls] = useState(me.calls);

  return (
    <>
      <div className="overflow-hidden rounded-[13px] bg-s1 shadow-[inset_0_0_0_1px_var(--line)]">
        <div className="relative h-[76px]">
          <Dither color={me.avatar.color} seed={`me-${me.name}`} cols={120} rows={19} light={0.8} />
        </div>
        <div className="flex items-end gap-3.5 px-4 pb-3.5">
          <span className="relative z-10 -mt-7 flex rounded-[24px] shadow-[0_0_0_4px_var(--pop)]">
            <MeAvatar me={me} size={76} />
          </span>
          <span className="min-w-0 flex-1 pb-0.5">
            <b className="block text-[15px] font-semibold">{me.name}</b>
            <span className="text-[12.5px] text-ink3">{me.calls || me.language}</span>
          </span>
          <span className="flex gap-1.5 pb-0.5">
            <Button variant="outline" size="sm" onClick={() => void uploadPhoto()}>
              <Upload />
              Upload photo
            </Button>
            {me.photo && (
              <Button variant="ghost" size="sm" onClick={() => void removePhoto()}>
                Remove
              </Button>
            )}
          </span>
        </div>
      </div>
      <SetHeading className="mt-4">About you</SetHeading>
      <Group>
        <div className="flex flex-col gap-2.5 px-3 py-[9px]">
          <span className="min-w-0">
            <b className="block text-[13px] leading-[1.4] font-medium">Avatar</b>
            <span className="mt-px block text-xs leading-[1.45] text-ink3">A face from the same family as your agents, or a photo.</span>
          </span>
          <div className="flex flex-col gap-2">
            <div role="radiogroup" aria-label="Face" className="grid grid-cols-[repeat(8,30px)] gap-1">
              {MASCOT_KINDS.map((kind) => {
                const on = !me.photo && me.avatar.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={kind}
                    onClick={() => updateMe({ avatar: { kind, color: me.avatar.color } })}
                    className={cn(
                      "grid aspect-square cursor-pointer place-items-center rounded-(--r2) transition-colors hover:bg-s2",
                      on && "bg-s3 shadow-[inset_0_0_0_1px_var(--line3)]",
                    )}
                  >
                    <Mascot kind={kind} color={me.avatar.color} size={20} />
                  </button>
                );
              })}
            </div>
            <Swatches size={18} value={me.avatar.color} onChange={(color) => updateMe({ avatar: { kind: me.avatar.kind, color } })} />
          </div>
        </div>
        <Row
          lead={<User />}
          title="Name"
          right={
            <Inline
              aria-label="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                updateMe({ name: e.target.value });
              }}
            />
          }
        />
        <Row
          lead={<AtSign />}
          title="What agents call you"
          sub="Put in every agent's briefing."
          right={
            <Inline
              aria-label="What agents call you"
              value={calls}
              placeholder="Gabriel, founder of Hyze Cloud"
              onChange={(e) => {
                setCalls(e.target.value);
                updateMe({ calls: e.target.value });
              }}
            />
          }
        />
        <Row
          lead={<Globe />}
          title="Language"
          right={<Pick label="Language" value={me.language} options={LANGUAGES.map((l) => ({ value: l, label: l }))} onChange={(language) => updateMe({ language })} />}
        />
        <Row
          lead={<Bell />}
          title="Status"
          sub="Focus lets only “needs you” through. Away holds everything and tells you what you missed when you are back."
          right={
            <Pick<MeStatus>
              label="Status"
              value={me.status}
              options={STATUSES.map((s) => ({ value: s.id, label: s.label, lead: <i className={cn("size-[7px] rounded-full", s.dot)} /> }))}
              shown={<><i className={cn("size-[7px] rounded-full", statusMeta(me.status).dot)} />{statusMeta(me.status).label}</>}
              onChange={(status) => updateMe({ status })}
            />
          }
        />
      </Group>
    </>
  );
}
