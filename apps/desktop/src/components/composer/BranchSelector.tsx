import GitBranchIcon from "@/components/icons/GitBranchIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BranchList } from "@/types/events";

export default function BranchSelector({
  branches,
  value,
  onSelect,
  disabled = false,
}: {
  branches: BranchList | null;
  value: string | null;
  onSelect: (branch: string) => void;
  /// True while the switch popover is open over this picker — reopening the
  /// menu underneath it would offer a second branch before the first resolves.
  disabled?: boolean;
}) {
  // A folder that isn't a repo has no branches, and an empty picker is worse
  // than no picker.
  if (!branches?.branches.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          // The popover above already dims the row; going translucent on top of
          // that would read as broken rather than busy.
          // `w-full` because this button's wrapper is the row's only shrinkable
          // item: when the controls outgrow the line the wrapper gives up its
          // width, and the button has to give up its own with it — otherwise it
          // keeps the full 160px cap and paints over the permission picker
          // beside it. `min-w-0` on both so the name ellipsises instead of
          // setting the button's floor.
          className="w-full min-w-0 max-w-40 gap-1.5 px-1.5 text-ui text-muted-foreground disabled:opacity-100"
        >
          <GitBranchIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {value ?? branches.current ?? "detached"}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-44">
        {/* Picking a branch checks it out for real, so the count is a heads-up
            that the next click opens a dialog rather than switching outright. */}
        {branches.dirty > 0 && (
          <DropdownMenuLabel className="text-ui font-normal text-muted-foreground">
            {branches.dirty} uncommitted{" "}
            {branches.dirty === 1 ? "change" : "changes"}
          </DropdownMenuLabel>
        )}

        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onSelect}>
          {branches.branches.map((b) => (
            <DropdownMenuRadioItem key={b} value={b} className="text-ui">
              <span className="truncate">{b}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
