import { Reply, X } from "lucide-react";

import { mixHex } from "@/lib/mascots";
import type { ReplyDraft } from "@/lib/replyDraft";
import { useRoster } from "@/lib/roster";
import { useMe } from "@/hooks/useMe";

/// The strip over the composer's text while a message is being answered: who it
/// is, one line of what they said, and an x. The quoted person's colour runs down
/// its left edge, the same bar the sent message will carry.
export default function ReplyBar({ draft, onCancel }: { draft: ReplyDraft; onCancel: () => void }) {
  const roster = useRoster();
  const me = useMe();
  const color =
    draft.agent === "me" ? me.avatar.color : (roster.agents.find((a) => a.id === draft.agent)?.color ?? me.avatar.color);

  return (
    <div className="grid animate-in grid-cols-[1fr_auto] gap-x-2 border-b border-line py-[11px] pr-2 pl-4 fade-in-0">
      <div className="flex items-center gap-1.5 text-xs text-ink3">
        <Reply className="size-[13px] text-ink4" />
        Replying to <b className="font-[550] text-ink">{draft.name}</b>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        title="Cancel reply · Esc"
        className="col-start-2 row-span-2 row-start-1 grid size-[26px] cursor-pointer place-items-center self-center rounded-(--r1) text-ink4 transition-colors hover:bg-hover hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
      <div
        className="col-start-1 mt-1.5 truncate pl-2.5 text-[13px] leading-[18px] text-ink2"
        style={{ boxShadow: `inset 2px 0 0 ${mixHex(color, "#ffffff", 0.1)}` }}
      >
        {draft.text}
      </div>
    </div>
  );
}
