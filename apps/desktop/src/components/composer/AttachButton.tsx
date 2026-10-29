import { Plus } from "lucide-react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/// The `+` that opens the file picker. It sits inside the prompt's own row, so
/// the control row above the card has nothing left to draw.
export default function AttachButton({ onAttach }: { onAttach: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* No radius override: `icon-sm` already carries the app's rounded-square. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onAttach}
          aria-label="Attach files"
          className="size-[30px] shrink-0 rounded-lg text-ink3 hover:bg-s3 hover:text-ink [&_svg]:size-[17px]"
        >
          <Plus strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        Attach files
        <ShortcutKeys ids={["attach"]} />
      </TooltipContent>
    </Tooltip>
  );
}
