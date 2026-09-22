import { useMemo, useState } from "react";
import { ChevronRight, RefreshCw, Search } from "lucide-react";

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
import {
  BYOK_FALLBACK_CONTEXT,
  BYOK_FALLBACK_OUTPUT,
  compactLimit,
  limitLabel,
} from "@/lib/providerLimits";
import { cn } from "@/lib/utils";
import type { ModelId, ProviderModel } from "@/types/events";

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
/// **The row opens, the switch switches, and they are two buttons rather than
/// one.** The row was the switch until it had a second job: a click that both
/// opened a model's facts and turned it off would do whichever half the reader
/// did not mean. A real `Switch` inside the opening row would be a button inside
/// a button.
export default function ProviderModels({
  rows,
  windows,
  hidden,
  onHiddenChange,
  onRefresh,
  loading,
}: {
  /// The models this provider serves, one row per model — grouped by
  /// [`byBase`]. Computed by the caller, because the card's own facts line
  /// counts the same rows.
  rows: ModelRow[];
  /// The context window each of this provider's models is registered with, by
  /// the key [`byBase`] grouped the rows under. Absent for a row the provider
  /// entry says nothing about — which is the state the row draws as `default`.
  windows: Record<string, ProviderModel>;
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
              entry={windows[row.key]}
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

/// One model: the switch that decides whether the picker draws it, and **the
/// window it will run at, editable in place**.
///
/// The name leads and the agent's own spelling trails it, muted: the two differ
/// by the separators a reader would never type as spaces — `minimax-m3` draws as
/// `MiniMax M3` — so the spelling is what tells two rows apart that prettify to
/// the same words, and it is noise on every row where they already agree.
///
/// **And it is the same folded spelling everything else reads** — `modelSlug`, so
/// `meta/muse-spark-1.3` trails as `muse-spark-1.3` rather than as a path.
///
/// **Both facts come from the agent, and none of them is typed here.** A window
/// the gateway stated is drawn as registered; one it never stated is resolved
/// against the catalog the agent ships, so a million-token model stops reading as
/// a fifth of its window.
///
/// **What the row draws is the model's name and whether it is on.** Everything
/// else — the window, the output budget, the ladder, the variants — is behind a
/// click, because a list of forty rows is read by name and a column of numbers
/// beside every one of them is read by nobody. Two controls, never one: the
/// switch is a button of its own so that opening a model cannot switch it off.
function ModelSwitchRow({
  row,
  entry,
  on,
  onToggle,
}: {
  row: ModelRow;
  /// This model's entry in the agent's provider config, where there is one —
  /// which is what says whether a window was ever recorded for it.
  entry: ProviderModel | undefined;
  on: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const model = row.variants[0];
  const label = model.label;
  const name = modelDisplayName(label);
  const slug = modelSlug(label);
  // **The agent's own row first, because it is the only source that knows.**
  // The provider listing has no limits at all (`{modelId, displayName, selected}`),
  // which is why this row used to draw the fallback for every model it had — a
  // `200k default` on one that runs at a million. The agent states the window on
  // the model itself now, patch and gateway settled there, so the fallback is
  // what is left for a model nobody has spoken about.
  const window = limitLabel(model.contextWindow ?? entry?.contextLimit, BYOK_FALLBACK_CONTEXT);
  const output = limitLabel(model.maxTokens ?? entry?.maxOutputTokens, BYOK_FALLBACK_OUTPUT);
  // **The row is one model and the wire lists it per variant**, so the ladder and
  // the variant names are read off whichever variant carries them: the agent
  // states a ladder for the one it is running and leaves the others empty, and a
  // row that read only its first variant would show nothing for a model whose
  // ladder arrived on the second.
  const stated = row.variants.find((variant) => variant.efforts.length > 0);
  const efforts = stated?.efforts ?? [];
  const effortDefault = stated?.defaultEffort ?? null;
  const variants = row.variants.flatMap((variant) => (variant.variant ? [variant.variant] : []));

  return (
    <div className="flex flex-col">
      {/* **A grid, because a list is read down a column.** The name and the
          agent's spelling are columns of fixed width, so the slugs line up under
          each other instead of trailing each name, and the chevron and the
          switch are fixed too — a switch that moved with the length of whatever
          sat beside it is what made a column of them look scattered. */}
      <div className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-sidebar-accent/50">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${name} details`}
          onClick={() => setOpen((was) => !was)}
          className="grid min-w-0 flex-1 cursor-pointer grid-cols-[1rem_11rem_minmax(0,1fr)_1rem] items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <ModelMark name={label} />

          <span className={cn("truncate text-ui", on ? "text-foreground" : "text-muted-foreground")}>
            {name}
          </span>

          <span className="truncate font-mono text-[0.7rem] text-muted-foreground/60">
            {name !== slug ? slug : ""}
          </span>

          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 justify-self-end text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
          />
        </button>

        {/* **The switch is the row's one control, and the rest of the row is
            not it.** It used to be the whole row, which read well until the
            row had something else to do: a click that both opened a model and
            switched it off would do the wrong one of the two. Drawn rather than
            a `Switch` — a real one is a button inside a button. */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`Show ${name} in the model picker`}
          onClick={onToggle}
          className={cn(
            "flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full p-px outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            on ? "bg-primary" : "bg-muted-foreground/30",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-3.5 rounded-full bg-background transition-transform",
              on && "translate-x-3",
            )}
          />
        </button>
      </div>

      {/* **Everything the number in the row was crowding out, said once, where
          there is room to say it.** The window is the fact a reader comes here
          for — a model with none is drawn at the agent's own 200k — and it now
          has a line of its own with the reason on it, instead of a two-column
          compromise at the end of a row. */}
      {open && (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 pb-2 pl-[2.125rem] text-[0.7rem]">
          <Detail label="Context">
            <span
              title={
                window.recorded
                  ? "The context window this model was registered with"
                  : `Nothing stated for this model, so the agent falls back to its own ${compactLimit(BYOK_FALLBACK_CONTEXT)}`
              }
              className={cn(
                "tabular-nums",
                window.recorded ? "text-muted-foreground" : "text-muted-foreground/50",
              )}
            >
              {window.text}
              {!window.recorded && <span className="ml-1.5">default</span>}
            </span>
          </Detail>

          <Detail label="Max output">
            <span
              className={cn(
                "tabular-nums",
                output.recorded ? "text-muted-foreground" : "text-muted-foreground/50",
              )}
            >
              {output.text}
              {!output.recorded && <span className="ml-1.5">default</span>}
            </span>
          </Detail>

          {/* Only where the agent has stated a ladder. It states one for the
              model it is running and leaves the others empty, and an empty one
              drawn as "none" would be a claim about a model nobody asked. */}
          {efforts.length > 0 && (
            <Detail label="Effort">
              {efforts.join(" · ")}
              {effortDefault && (
                <span className="ml-1.5 text-muted-foreground/50">default {effortDefault}</span>
              )}
            </Detail>
          )}

          {/* **No image row, and that is not an omission.** `accepts_images` is
              the agent's own answer rather than the model's — mcode declares
              `promptCapabilities.image: false` and its ACP adapter *throws* on an
              image content block — so it is `false` on every row here, and a line
              saying so would read as a claim about the model. A vision model is
              still reached the long way: an attached image goes in as a path and
              the agent reads the file. */}

          {/* The wire lists a variant as a choice of its own — `minimax-m3` and
              `minimax-m3 · thinking` — so which ones a row carries is the
              answer to why the picker shows two entries for one model. */}
          {variants.length > 0 && <Detail label="Variants">{variants.join(" · ")}</Detail>}

        </dl>
      )}
    </div>
  );
}

/// One labelled fact under an open row.
///
/// A `dl` pair rather than a sentence, so a value that is a number starts at the
/// same x on every row and the eye can run down it — the whole reason the numbers
/// left the row in the first place.
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground/60">{label}</dt>
      <dd className="min-w-0 text-muted-foreground">{children}</dd>
    </>
  );
}
