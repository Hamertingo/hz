import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { modelDisplayName } from "@/lib/modelBrand";
import type { Model, ModelId } from "@/types/events";

/// Opens a review of the newest turn, on a model the reader picks.
///
/// **The pick is the feature rather than a setting.** A second opinion is worth
/// having because it is somebody else's, and which model gives it is the one
/// thing the app cannot decide — there is no sensible default, because the model
/// that did the work is the one opinion this is not asking for.
///
/// The list is every row the composer's picker draws, **including the one that
/// did the work**: a disabled row would look available and answer nothing, and a
/// reader deliberately asking that model to look again is asking something real
/// — it has none of the first agent's sunk cost and none of its conversation.
export default function SecondOpinionAction({
  models,
  busy,
  disabled,
  onPick,
}: {
  models: Model[];
  /// A review is already being opened. The control waits rather than queueing a
  /// second one behind the first, each of which is a worktree and a child.
  busy: boolean;
  /// Nothing to review: no finished turn, or no project attached.
  disabled: boolean;
  onPick: (model: ModelId) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="xs" disabled={disabled || busy}>
          <Eye />
          {busy ? "Opening…" : "Second opinion"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {/* A heading rather than a bare list: what the rows below are for is the
            whole question, and a menu of forty model names does not say it. */}
        <DropdownMenuLabel className="text-muted-foreground">Review with…</DropdownMenuLabel>
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            className="text-ui"
            onSelect={() => onPick(model.id)}
          >
            <span className="min-w-0 truncate">{modelDisplayName(model.label)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
