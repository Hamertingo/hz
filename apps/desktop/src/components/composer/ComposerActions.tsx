import { AtSign, Slash, Smile } from "lucide-react";
import { useState } from "react";

import EmojiPicker from "@/components/chat/EmojiPicker";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { insertIntoComposer } from "@/lib/composerFocus";

export const TOOL = "size-[30px] shrink-0 rounded-lg text-ink3 hover:bg-s3 hover:text-ink [&_svg]:size-[17px]";

/// The smiley beside the attach button: opens the emoji grid and types the pick
/// into the draft at the caret.
export function EmojiButton({ sessionId }: { sessionId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Emoji"
              onMouseDown={(e) => e.preventDefault()}
              className={TOOL}
            >
              <Smile strokeWidth={1.75} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Emoji</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="start">
        <EmojiPicker onPick={(emoji) => insertIntoComposer(sessionId, emoji)} />
      </PopoverContent>
    </Popover>
  );
}

/// Types an `@` at the caret, which opens the same list typing one does.
export function MentionButton({ sessionId }: { sessionId: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Mention"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertIntoComposer(sessionId, "@")}
          className={TOOL}
        >
          <AtSign strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Mention</TooltipContent>
    </Tooltip>
  );
}

/// Types a `/` at the caret, which opens the command list the way typing one does.
export function SlashButton({ sessionId }: { sessionId: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Commands"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertIntoComposer(sessionId, "/")}
          className={TOOL}
        >
          <Slash strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Commands</TooltipContent>
    </Tooltip>
  );
}
