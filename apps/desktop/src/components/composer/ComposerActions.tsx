import { AtSign, Smile } from "lucide-react";
import { useState } from "react";

import EmojiPicker from "@/components/chat/EmojiPicker";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { insertIntoComposer } from "@/lib/composerFocus";

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
              size="icon-xs"
              aria-label="Emoji"
              onMouseDown={(e) => e.preventDefault()}
              className="text-muted-foreground hover:text-foreground"
            >
              <Smile />
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
          size="icon-xs"
          aria-label="Mention"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertIntoComposer(sessionId, "@")}
          className="text-muted-foreground hover:text-foreground"
        >
          <AtSign />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Mention</TooltipContent>
    </Tooltip>
  );
}
