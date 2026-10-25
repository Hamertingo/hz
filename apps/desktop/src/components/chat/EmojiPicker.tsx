import { EMOJI_GROUPS } from "@/lib/emoji";

/// The grid inside the emoji popovers: the reaction picker on a message and the
/// button in the composer share it, so both offer the same set.
export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="flex w-[264px] flex-col gap-2">
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-1 pb-1 text-[11px] font-medium text-ink4">{group.label}</div>
          <div className="grid grid-cols-8 gap-0.5">
            {group.items.map((emoji) => (
              <button
                key={emoji}
                type="button"
                // Keeps the caret where it was when this opens from the composer.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(emoji)}
                aria-label={emoji}
                className="grid size-8 cursor-pointer place-items-center rounded-(--r1) text-[17px] transition-transform hover:scale-110 hover:bg-hover"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
