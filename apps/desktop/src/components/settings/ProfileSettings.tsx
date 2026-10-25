import { Upload } from "lucide-react";
import { useState } from "react";

import MeAvatar from "@/components/MeAvatar";
import Mascot from "@/components/Mascot";
import { Lead, StudioRow } from "@/components/settings/StudioRow";
import Swatches from "@/components/Swatches";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { removePhoto, updateMe, uploadPhoto, useMe } from "@/hooks/useMe";
import { LANGUAGES, STATUSES } from "@/lib/me";
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
      <Lead>How you appear to your agents and in every chat.</Lead>

      <div className="-mt-4">
        <StudioRow label="Avatar" hint="A face from the same family as your agents, or a photo.">
          <div className="flex items-center gap-4">
            <MeAvatar me={me} size={72} />
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
                        "grid aspect-square cursor-pointer place-items-center rounded-(--r2) transition-colors hover:bg-hover",
                        on && "bg-active shadow-[inset_0_0_0_1px_var(--line3)]",
                      )}
                    >
                      <Mascot kind={kind} color={me.avatar.color} size={20} />
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Swatches
                  size={18}
                  value={me.avatar.color}
                  onChange={(color) => updateMe({ avatar: { kind: me.avatar.kind, color } })}
                />
                <Button variant="outline" size="sm" className="ml-2" onClick={() => void uploadPhoto()}>
                  <Upload />
                  Upload photo
                </Button>
                {me.photo && (
                  <Button variant="outline" size="sm" onClick={() => void removePhoto()}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
        </StudioRow>

        <StudioRow label="Name" hint="What the chat shows beside your messages.">
          <input
            aria-label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              updateMe({ name: e.target.value });
            }}
            className={fieldClassName}
          />
        </StudioRow>

        <StudioRow label="What agents call you" hint="Put in every agent's briefing.">
          <input
            aria-label="What agents call you"
            value={calls}
            placeholder="Gabriel, founder of Hyze Cloud"
            onChange={(e) => {
              setCalls(e.target.value);
              updateMe({ calls: e.target.value });
            }}
            className={fieldClassName}
          />
        </StudioRow>

        <StudioRow label="Language" hint="The one agents answer in unless told otherwise.">
          <Segmented
            label="Language"
            value={me.language}
            onChange={(language) => updateMe({ language })}
            options={LANGUAGES.map((l) => ({ value: l, label: l }))}
          />
        </StudioRow>

        <StudioRow
          label="Status"
          hint="Focus lets only “needs you” through. Away holds everything and tells you what you missed when you are back."
        >
          <Segmented<MeStatus>
            label="Status"
            value={me.status}
            onChange={(status) => updateMe({ status })}
            options={STATUSES.map((s) => ({ value: s.id, label: s.label }))}
          />
        </StudioRow>
      </div>
    </>
  );
}
