import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import ModelMark from "@/components/ModelMark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { modelDisplayName } from "@/lib/modelBrand";
import { byBase, byProvider, matchingRows, toggleRotation } from "@/lib/modelRotation";
import { cn } from "@/lib/utils";
import type { Model, ModelId } from "@/types/events";

/// Where the reader's stars are set — the models they switch between, which lead
/// the picker and are what Shift+Tab cycles.
///
/// **Not the gate to the picker, and it used to be.** The picker drew the
/// shortlist and nothing else, so a model was reachable only after being starred
/// here: one provider's 37 models, one star at a time, through a second surface.
/// It now draws every model the harness serves, and a star is a shortcut inside
/// that list — a thing with 37 rows in it is worth ordering, and worth an editor
/// for the ordering.
///
/// Starring is the only thing this dialog does. It does not pick a model, and
/// deliberately: a row that both starred and selected would leave no way to say
/// "next time, this one" without switching the session onto it.
export default function ModelLibraryDialog({
  open,
  onOpenChange,
  models,
  rotation,
  onRotationChange,
  onRefresh,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: Model[];
  rotation: ModelId[];
  onRotationChange: (next: ModelId[]) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () => byProvider(matchingRows(byBase(models), query)),
    [models, query],
  );

  const kept = new Set(rotation);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Taller and wider than the settings dialog: this one is a list to scan,
          where that one is rows to read. */}
      <DialogContent className="flex max-h-[70vh] max-w-120 flex-col gap-3 p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Models</DialogTitle>
          <DialogDescription>
            Everything the agent serves is on. Switch off the ones you never use —
            the rest lead the picker, and ⇧Tab cycles exactly them.
          </DialogDescription>
        </DialogHeader>

        {/* No fill and no border, the search bar the issues page already uses:
            it is the one control always in the same place, so the glyph says
            "type here" without drawing a box round the list underneath. No rule
            under it either, for the same reason — the list below already starts
            with a provider heading, so the line separated two things that were
            not being confused for one another. */}
        <div className="flex h-9 shrink-0 items-center gap-2 px-5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            placeholder="Search models"
            spellCheck={false}
            // `dark:bg-transparent` as well as `bg-transparent`: the base input
            // carries `dark:bg-input/30`, the more specific rule, so a plain
            // override reads as removed in source while the fill stays on screen.
            className="h-full rounded-none border-0 bg-transparent p-0 text-ui shadow-none focus-visible:ring-0 dark:bg-transparent"
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          {/* The list is the agent's answer, not a table, so it goes stale the
              moment a provider is logged in. Nothing else on screen can say so. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            title="Refresh"
            onClick={onRefresh}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {groups.length === 0 && (
            <p className="px-3 py-6 text-center text-ui text-muted-foreground">
              {loading
                ? "Reading the model list…"
                : models.length === 0
                  ? "No models came back. Log a provider in and refresh."
                  : `Nothing matches “${query}”.`}
            </p>
          )}

          {groups.map((group) => (
            <div key={group.provider} className="mb-1">
              {/* Muted, no fill and no glyph, the sidebar's project heading:
                  a tinted band draws a box round the quietest line on screen.
                  Drawn only when two providers share the list — one provider's
                  lone heading names what nothing disputes. */}
              {groups.length > 1 && (
                <p className="px-3 pt-2 pb-1 text-ui text-muted-foreground">
                  {group.provider}
                </p>
              )}
              {group.rows.map((row) => {
                // One row is one model, so its variants are switched together —
                // half of one would leave the picker drawing it as a model that is
                // partly kept, with no sign of which half.
                const ids = row.variants.map((v) => v.id);
                const isKept = ids.every((id) => kept.has(id));
                return (
                  // The whole row is the target, and it carries the switch role
                  // itself — a real `Switch` here would be a button inside a
                  // button, which is invalid and gives the row two hit areas
                  // where the reader sees one. Same bargain `WorktreeToggle`
                  // makes with its own hand-drawn track.
                  <button
                    key={row.key}
                    type="button"
                    role="switch"
                    aria-checked={isKept}
                    onClick={() => onRotationChange(toggleRotation(rotation, ids))}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-ui hover:bg-accent"
                  >
                    <ModelMark name={row.variants[0].label} />
                    <span className="min-w-0 truncate">
                      {modelDisplayName(row.variants[0].label)}
                    </span>
                    {/* The id used to sit here, and for most models it is the
                        label again with a slash in it — the same name twice on
                        one row. The state is what the row is for, so it takes
                        the slot. */}
                    <span
                      aria-hidden
                      className={cn(
                        "ml-auto flex h-4 w-7 shrink-0 items-center rounded-full p-px transition-colors",
                        isKept ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    >
                      <span
                        className={cn(
                          "size-3.5 rounded-full bg-background transition-transform",
                          isKept && "translate-x-3",
                        )}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
