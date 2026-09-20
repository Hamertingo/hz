import { Archive } from "lucide-react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { restoreAttachments } from "@/hooks/useAttachments";
import { appendToDraft } from "@/hooks/useDraft";
import { popStash, useStashCount } from "@/hooks/useStash";

/// The drafts put aside, if any, and the way back to the newest.
///
/// Drawn only when there is something stashed: a control that restores nothing
/// is one the reader presses once and never trusts again — the rule the update
/// row and the handoff row follow too.
///
/// It writes the draft and the attachments through their own stores rather than
/// through `ChatInput`: this row is handed to the composer as an opaque node, so
/// the two cannot pass props to each other. That is why those stores are
/// module-level in the first place.
export default function StashBadge({ sessionId }: { sessionId: string | null }) {
  const count = useStashCount(sessionId);
  if (!count) return null;

  const label = count === 1 ? "Restore the stashed draft" : `Restore a stashed draft (${count})`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={() => {
            const restored = popStash(sessionId);
            if (!restored) return;

            // Appended, not assigned: a stash goes back *into* whatever is being
            // written now, so restoring can never destroy a sentence typed while
            // it was away. `appendToDraft` is the same join dictation uses — one
            // space unless the draft already ends in whitespace.
            appendToDraft(sessionId, restored.text);
            restoreAttachments(sessionId, restored.attachments);
          }}
          className="relative cursor-pointer text-muted-foreground"
        >
          <Archive />
          {count > 1 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-3 rounded-full bg-muted px-0.5 text-center text-[9px] leading-3 text-muted-foreground">
              {count}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        <ShortcutKeys ids={["stash.prompt"]} />
      </TooltipContent>
    </Tooltip>
  );
}
