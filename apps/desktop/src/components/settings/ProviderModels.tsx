import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import ModelMark from "@/components/ModelMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  everyHidden,
  hiddenSet,
  type ModelRow,
  matchingRows,
  rowShown,
  toggleHidden,
} from "@/lib/modelVisibility";
import { modelSlug } from "@/lib/model";
import { modelDisplayName } from "@/lib/modelBrand";
import { cn } from "@/lib/utils";
import type { ModelId } from "@/types/events";

/// Above this many models the list gets a filter box. A provider that serves
/// four needs no chrome over four rows; one that serves forty is not a list
/// anybody reads top to bottom.
const FILTER_THRESHOLD = 8;

/// Every model one provider serves, each with its own switch.
///
/// **The switch decides whether the model is in the picker at all**, which is
/// what makes this a list to read rather than a list of stars: a model that is on
/// is a row in the composer's menu, and one that is off is not. All of them start
/// on, so the state a reader meets is "everything I connected is available" — see
/// `HIDDEN_MODELS_KEY`, which says why the stored half is the hidden one.
///
/// **A row is one model, and its variants move together.** The wire lists a
/// variant as a choice of its own — `glm-5.3` and `glm-5.3 · thinking` — but a
/// reader switching one of those off and not the other has expressed nothing:
/// the model is half in the picker, with no sign of which half.
///
/// **The row is the switch**, the same bargain `WorktreeToggle` makes: a real
/// `Switch` inside would be a button inside a button, and would give the reader
/// two hit areas where they see one.
export default function ProviderModels({
  rows,
  hidden,
  onHiddenChange,
  onRefresh,
  loading,
}: {
  /// The models this provider serves, one row per model — grouped by
  /// [`byBase`]. Computed by the caller, because the card's own facts line
  /// counts the same rows.
  rows: ModelRow[];
  hidden: ModelId[];
  onHiddenChange: (next: ModelId[]) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");

  const off = hiddenSet(hidden);
  const shown = useMemo(() => matchingRows(rows, query), [rows, query]);
  const allOff = everyHidden(rows, off);
  const filterable = rows.length > FILTER_THRESHOLD;

  /// Everything on or everything off, which is the one thing worth doing in bulk:
  /// a provider serving forty models is forty presses to a short list otherwise.
  const bulk = () =>
    onHiddenChange(
      allOff ? [] : rows.flatMap((row) => row.variants.map((model) => model.id)),
    );

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        {filterable && (
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              placeholder="Filter models"
              spellCheck={false}
              aria-label="Filter models"
              // The base input's own fill and border are the dialog's look rather
              // than a row's, so both are turned off — `dark:bg-transparent`
              // too, since that rule is the more specific one.
              className="h-full rounded-none border-0 bg-transparent p-0 text-ui shadow-none focus-visible:ring-0 dark:bg-transparent"
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          </div>
        )}

        {/* No count here. How many models this provider serves, and how many of
            them are switched off, is the card's own facts line — said once, on
            the card, where it is still read while this is closed. */}
        <span className="ml-auto" />

        {rows.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 cursor-pointer text-muted-foreground"
            onClick={bulk}
          >
            {allOff ? "Show all" : "Hide all"}
          </Button>
        )}

        {/* The list is the agent's answer rather than a table, so it goes stale
            the moment a provider is reconnected or a key is replaced. Nothing
            else on this card can say so. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 cursor-pointer text-muted-foreground"
          aria-label="Refresh the model list"
          onClick={onRefresh}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-3 text-ui text-muted-foreground">
          {rows.length === 0
            ? "This provider reported no models. Refresh once it is connected, or connect it again."
            : `Nothing matches “${query}”.`}
        </p>
      ) : (
        <div className="flex flex-col px-1.5 pb-2">
          {shown.map((row) => (
            <ModelSwitchRow
              key={row.key}
              row={row}
              on={rowShown(row, off)}
              onToggle={() =>
                onHiddenChange(toggleHidden(hidden, row.variants.map((model) => model.id)))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/// One model, and the switch that decides whether the picker draws it.
///
/// The name leads and the agent's own spelling trails it, muted: the two differ
/// by the separators a reader would never type as spaces — `minimax-m3` draws as
/// `MiniMax M3` — so the spelling is what tells two rows apart that prettify to
/// the same words, and it is noise on every row where they already agree.
///
/// **And it is the same folded spelling everything else reads** — `modelSlug`, so
/// `meta/muse-spark-1.3` trails as `muse-spark-1.3` rather than as a path. What
/// a pick actually sends is `Model.arg`, which this row never stated anyway; the
/// search still finds the row by the whole id, publisher prefix and all.
function ModelSwitchRow({
  row,
  on,
  onToggle,
}: {
  row: ModelRow;
  on: boolean;
  onToggle: () => void;
}) {
  const label = row.variants[0].label;
  const name = modelDisplayName(label);
  const slug = modelSlug(label);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Show ${name} in the model picker`}
      onClick={onToggle}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent/50"
    >
      <ModelMark name={label} />

      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={cn("truncate text-ui", on ? "text-foreground" : "text-muted-foreground")}>
          {name}
        </span>
        {name !== slug && (
          <span className="truncate font-mono text-[0.7rem] text-muted-foreground/60">
            {slug}
          </span>
        )}
      </span>

      {/* Drawn rather than a `Switch`, for the reason the whole row is the
          target: a real one would be a button inside a button. */}
      <span
        aria-hidden
        className={cn(
          "ml-auto flex h-4 w-7 shrink-0 items-center rounded-full p-px transition-colors",
          on ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "size-3.5 rounded-full bg-background transition-transform",
            on && "translate-x-3",
          )}
        />
      </span>
    </button>
  );
}
