import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Sliders } from "lucide-react";
import AgentIcon from "@/components/AgentIcon";
import ModelMark from "@/components/ModelMark";
import ModelLibraryDialog from "@/components/composer/ModelLibraryDialog";
import { useFanOutModels, toggleFanOutModel, clearFanOut } from "@/hooks/useModelFanOut";
import { canFanOut, isFanOut } from "@/lib/fanOut";
import { modelDisplayName } from "@/lib/modelBrand";
import { usePreference } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import {
  byProvider,
  discoveredList,
  matchingRows,
  type ModelRow,
  rowModel,
  rowOf,
  MODEL_ROTATION_KEY,
  modelRotation,
  topLevel,
  underMore,
} from "@/lib/modelRotation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import ShortcutKeys from "@/components/ShortcutKeys";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { offersFast } from "@/lib/fastMode";
import { isUnsetModel } from "@/lib/model";
import type { Effort, Harness, Model, ModelId } from "@/types/events";

const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultra: "Ultra",
  max: "Max",
};

/// What a variant is called on screen, in the reader's words rather than the
/// wire's.
///
/// `thinking` is the switch they turn on, and the empty variant — the id with a
/// `:v:` and nothing after it — is the model running as it always does. A
/// variant this table does not know is drawn as the wire spelled it, which is
/// the only name anybody has for it.
const VARIANT_LABELS: Record<string, string> = {
  thinking: "Thinking",
  "": "Default",
};

/// Next effort level for `model`, wrapping — what ⌘⇧E lands on. `null`
/// where the model offers nothing to cycle, so the chord no-ops rather than
/// inventing an effort the CLI would ignore.
///
/// `low` is left out of the cycle and stays pickable from the menu: a blind
/// chord landing on it makes the model worse at the work, which is not
/// something anyone reaches for a shortcut to do. An effort outside the
/// remaining list — `low` itself included — enters at the start.
export function nextEffort(model: Model | undefined, current: Effort | null): Effort | null {
  const cycle: Effort[] = model?.efforts.filter((e) => e !== "low") ?? [];
  if (cycle.length === 0) return null;
  const from = current ?? model?.defaultEffort ?? null;
  const i = from ? cycle.indexOf(from) : -1;
  return cycle[(i + 1) % cycle.length];
}

/// Which model the session runs and at what effort — one control, because the
/// two are one decision.
///
/// The agent used to sit in here as a row of its own, and no longer can: there
/// is one, it is the child process, and a switch with a single position is a
/// control that cannot be reached. Its mark stays on the trigger, where it names
/// the agent at rest rather than only while the menu is open.
///
/// A model with variants is drawn as **one** row: the wire lists a variant as a
/// choice of its own, but three rows reading `glm-5.3`, `glm-5.3 · thinking` is
/// one idea drawn three times. The variant is the row's second control, beside
/// the name, and the effort ladder is the third — see [`ModelRow`].
///
/// **Shift-click builds a second thing.** Plain click picks one model, the way it
/// always did. Shift-click adds the row to a fan-out set and leaves the menu
/// open, and a send with two or more in it creates one session — and one
/// worktree — per model. The whole machinery for that already existed (the
/// worktree, the spawn, the nested sidebar rows); what was missing was a way to
/// ask for it, so fan-out only happened when the agent itself called `hz new`.
///
/// The mark is the name's own colour, not a second check: a row can be the pick
/// *and* in the set, and two glyphs would be two words for one state.
///
/// **Shift has to be caught on the way in, not in `onSelect`.** Radix fires a
/// bare `CustomEvent` for a menu-item select — no `detail`, no `originalEvent` —
/// so the modifier is gone by the time the handler runs. It is read off the item's
/// own `pointerdown`/`pointermove`/`keydown` instead, which is also what makes a
/// shift-Enter work.
export default function ModelSelector({
  harness,
  models,
  modelId,
  effort,
  fast,
  onFastChange,
  fastNote,
  isNewSession,
  sessionId,
  onChange,
  onRefreshModels,
  onOpenProviderSettings,
  loadingModels = false,
}: {
  /// Which agent runs the session. Fixed for the life of the app, and read here
  /// for what it decides rather than for anything to draw: whether the list is a
  /// discovered one, and whether this agent has a fast mode to offer.
  harness: Harness;
  models: Model[];
  modelId: ModelId;
  effort: Effort | null;
  /// The session's fast-mode pick, as asked for rather than as clamped — the
  /// row below is drawn only where it can be honoured, so the two agree on
  /// screen, and `fastFor` is what settles it at the send.
  fast: boolean;
  onFastChange: (fast: boolean) => void;
  /// The harness's own sentence about fast mode on the newest turn, drawn under
  /// the row. Never reconciled into `fast` above — see `fastNotice`.
  fastNote: string | null;
  /// fx's fast mode is settled when its session is created and unreachable
  /// after, so the row it draws has to go once one exists.
  isNewSession: boolean;
  /// Which composer's fan-out set this is. `null` before a session exists, the
  /// same key `useDraft` and `useAttachments` use — the reader can set this up
  /// on the empty state and it has to survive into the session it starts.
  sessionId: string | null;
  onChange: (modelId: ModelId, effort: Effort | null) => void;
  /// Asks the harness for its list again, dropping the backend cache first.
  /// Only a discovered list can change under the reader — the other kind is a
  /// table — so it is optional here.
  onRefreshModels?: () => void;
  /// Opens the group where a provider is configured. Drawn only where there are
  /// no models at all, which on a fresh install is the state the picker opens
  /// in — an empty menu with no way out is the one dead end in this app.
  onOpenProviderSettings?: () => void;
  loadingModels?: boolean;
}) {
  // Controlled so a click on a submenu trigger can close the whole menu; Radix
  // otherwise keeps the parent open for the submenu it just opened on hover.
  const [open, setOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [query, setQuery] = useState("");
  // What a shift-click builds: one session and one worktree per model, all sent
  // by the same press. Empty is the ordinary case.
  const fanOut = useFanOutModels(sessionId);
  const searchRef = useRef<HTMLInputElement>(null);
  // One copy, held here and handed down: the dialog and the menu both read it,
  // and handing it down is what keeps them drawing the same rotation.
  const [chosenRotation, setChosenRotation] = usePreference(MODEL_ROTATION_KEY, null);
  // Resolved before anything reads it: nothing stored means every model, so a
  // fresh install opens the library with every switch on and ⇧Tab cycling what
  // the menu draws.
  const rotation = useMemo(() => modelRotation(models, chosenRotation), [models, chosenRotation]);

  // Every model the harness serves, the reader's rotation leading — see
  // [`topLevel`]. Shared with Shift+Tab, which cycles the kept models plus the
  // model the session is on: a chord landing on a model the menu never offered
  // is the bug the sharing prevents, and a model with variants is one step
  // there for the same reason it is one row here.
  const rows = useMemo(() => topLevel(models, rotation, harness), [models, rotation, harness]);
  const searched = useMemo(() => matchingRows(rows, query), [rows, query]);
  const more = useMemo(
    () => matchingRows(underMore(models, harness), query),
    [models, harness, query],
  );
  // Headings earn their place only when two providers share the list — a reader
  // picking between two providers' models needs to know which is which. A single
  // group's heading names what nothing disputes, so it is dropped.
  const providerGroups = useMemo(() => byProvider(searched), [searched]);
  // A discovered list is 37 models on one provider and more on several, which is
  // not a list anybody reads top to bottom. A written list is a handful of rows
  // hz named itself, where a search field would be chrome around three items.
  const searchable = discoveredList(harness) && models.length > 0;

  const selected = models.find((m) => m.id === modelId) ?? null;
  // Read over the whole list rather than the menu's own rows: the variant is
  // named beside the model on the trigger, and whether there is one to name is a
  // fact about the model rather than about what the menu happens to be drawing.
  const selectedRow = useMemo(() => rowOf(models, modelId), [models, modelId]);
  // The variant is a qualifier on the name and drawn like the others, so it is
  // held back where the model has no choice of them: 37 of mcode's 41 rows are
  // `· thinking`, and a word repeated on every row says nothing.
  const selectedVariant =
    selectedRow && selectedRow.variants.length > 1 ? selected?.variant : undefined;

  /// The trigger's own name. The model's where the list has it, and read off the
  /// id where it does not — while the probe is still out, or where the recorded
  /// pick is one the agent no longer serves. Never the wire's spelling of it: an
  /// id is addressing, and `modelLabel` is what turns one into a name.
  const selectedName = isUnsetModel(modelId)
    ? "Select Model"
    : modelDisplayName(selected?.label || modelId);

  // Radix focuses the menu content itself when it opens, and the reader's first
  // keystroke belongs in the search field. An `autoFocus` there cannot win — the
  // content's own focus lands after the field mounts — so the field takes it back
  // here, on the frame the menu opens. The arrow keys still walk the rows from
  // it, since Radix reads them off the content.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  /// What a row would resolve to if clicked: the live effort for the model
  /// already selected, each other model's own default. Mirrors the resolution
  /// in `useSessions`, so the menu can't advertise an effort the send wouldn't use.
  const rowEffort = (model: Model): Effort | null =>
    model.id === modelId ? effort : model.defaultEffort;

  /// One line per model, whatever the wire spent on it.
  ///
  /// Clicking picks the row as it stands — the variant it is already showing,
  /// since a click says "run this model" and not "change how". The variant is
  /// picked from the submenu, which is also how the row reads as one line: the
  /// name, then the variant, then the effort, all qualifiers of the same thing
  /// rather than two controls stacked.
  const modelRow = (row: ModelRow) => {
    const shown = rowModel(row, modelId);
    const chosen = row.variants.some((m) => m.id === modelId);
    const picked = isFanOut(fanOut, shown.id);
    // The variant, named only where the model has a choice of them — and named
    // in the reader's words, which is why the empty one reads `Default` and not
    // as nothing at all.
    const variant =
      row.variants.length > 1 ? (VARIANT_LABELS[shown.variant] ?? shown.variant) : null;
    const level = rowEffort(shown);

    const body = (
      <>
        <ModelMark name={shown.label} />
        {/* `min-w-0` on the name and `shrink-0` on what follows, or a long one
            pushes the qualifiers out of the menu rather than truncating. The
            tint is the fan-out's own mark: a row in the set that will run is
            coloured, and it is the only thing on the row that is not the model's
            own name for itself. */}
        <span className={cn("min-w-0 truncate", picked && "text-accent-mention")}>
          {modelDisplayName(shown.label)}
        </span>
        {(variant || level) && (
          // Right-aligned rather than trailing the name: a qualified row and a
          // plain one then start at the same place, and the name is what the eye
          // scans down. Muted a step further than the name, since these qualify
          // it rather than being part of it.
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground/60">
            {variant}
            {level && <span>{EFFORT_LABELS[level]}</span>}
          </span>
        )}
      </>
    );

    // Nothing to open: one variant, and no effort levels on it. Plain item, no
    // chevron promising a menu that would be empty.
    if (row.variants.length < 2 && shown.efforts.length === 0) {
      // Captured by the handlers below and read in `onSelect`, which Radix calls
      // with an event that carries no modifier — see the note above.
      let shift = false;

      return (
        <DropdownMenuItem
          key={row.key}
          className="text-ui"
          onPointerDown={(event) => {
            shift = event.shiftKey;
          }}
          onPointerMove={(event) => {
            shift = event.shiftKey;
          }}
          onKeyDown={(event) => {
            shift = event.shiftKey;
          }}
          onSelect={(event) => {
            // Shift adds to the fan-out set instead of picking, and the menu
            // stays open — the reader is building a list, and a menu that closed
            // on the first shift-click would make that a trip per model.
            // `preventDefault` is what stops Radix closing on select.
            if (shift) {
              event.preventDefault();
              toggleFanOutModel(sessionId, shown.id);
              return;
            }
            onChange(shown.id, null);
          }}
        >
          {body}
          {(chosen || picked) && (
            <Check
              className={cn("ml-auto size-3.5", picked && "text-accent-mention")}
            />
          )}
        </DropdownMenuItem>
      );
    }

    return (
      <DropdownMenuSub key={row.key}>
        <DropdownMenuSubTrigger
          className="cursor-pointer gap-1 text-ui"
          // The picked model takes a check where the submenu chevron would sit,
          // no leading indent and no background tint fighting the hover.
          // Unpicked rows keep the chevron that says "opens a submenu".
          trailingIcon={
            chosen || picked ? (
              <Check className={cn("ml-auto size-3.5", picked && "text-accent-mention")} />
            ) : undefined
          }
          onClick={(event) => {
            // Shift on a row that has a submenu adds it rather than opening that
            // submenu — the reader is choosing models, not variants.
            if (event.shiftKey) {
              event.preventDefault();
              toggleFanOutModel(sessionId, shown.id);
              return;
            }
            onChange(shown.id, null);
            setOpen(false);
          }}
        >
          {body}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {/* The variants first, then the ladder — and a rule only where both
              are drawn, since the one level of a row that has no variants
              needs no separation from itself. The ladder belongs to the variant
              above it: only the running model's own ladder is ever stated, and
              switching variant restates it. */}
          {row.variants.map((option) => (
            <DropdownMenuItem
              key={option.id}
              className="text-ui"
              onSelect={() => {
                onChange(option.id, null);
                setOpen(false);
              }}
            >
              {VARIANT_LABELS[option.variant] ?? option.variant}
              {option.id === modelId && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          ))}
          {row.variants.length > 1 && shown.efforts.length > 0 && <DropdownMenuSeparator />}
          {/* The ladder, with the chord that drives it. It lives on the control
              it drives rather than on the model trigger — that tooltip was
              carrying a shortcut for a thing one level down. No word beside it
              and no rule under it: the levels below say what it cycles, and a
              separator would draw a box round a hint. */}
          {shown.efforts.length > 0 && (
            <div className="flex px-1.5 py-1">
              <ShortcutKeys ids={["effort.next"]} />
            </div>
          )}
          {shown.efforts.map((option) => (
            <DropdownMenuItem
              key={option}
              className="text-ui"
              onSelect={() => {
                onChange(shown.id, option);
                setOpen(false);
              }}
            >
              {EFFORT_LABELS[option]}
              {option === level && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  };

  return (
    <DropdownMenu
      open={open}
      // The search is dropped on close: a query typed to find one model, still
      // in the field an hour later, hides every other model and reads as a
      // picker that lost them.
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {/* `text-ui` over the button's own `text-sm`: the toolbar has to track
                the runtime font-size setting like the rest of the chrome. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-1.5 text-ui text-muted-foreground"
            >
              {/* **The model's mark, not the agent's.** One harness runs here and
                  it is the child process, so a mark of *it* names the same thing
                  on every session in the app — where the mark of the model is a
                  second thing the button says, and the one the reader is looking
                  at when they want to change it. The agent's own mark stays for
                  the one state that has no model to draw: nothing picked yet. */}
              {isUnsetModel(modelId) ? (
                <AgentIcon harness={harness} brand className="size-3.5" />
              ) : (
                <ModelMark name={selected?.label || modelId} />
              )}
              {/* Model, then the qualifiers on it — effort and the variant — each
                  held back a step rather than reading as one long name. The
                  unset sentinel is not a name and there is no name to draw, so
                  the placeholder stands in. */}
              {canFanOut(fanOut) ? (
                // A fan-out send runs several models, so naming one of them
                // would be a lie about what the button does. The count is the
                // whole answer, and the models themselves are in the menu.
                <span className="text-accent-mention">{fanOut.length} models</span>
              ) : (
                <>
                  <span>{selectedName}</span>
                  {selectedVariant !== undefined && (
                    <span className="text-muted-foreground/60">
                      {VARIANT_LABELS[selectedVariant] ?? selectedVariant}
                    </span>
                  )}
                  {effort && (
                    <span className="text-muted-foreground/60">{EFFORT_LABELS[effort]}</span>
                  )}
                </>
              )}
              {/* The last qualifier, drawn exactly like the others: its
                  *presence* is what says fast mode is on, so colour would be a
                  second way to say one thing — and an accent here competes with
                  the yellow the sidebar spends on sessions wanting the reader. A
                  glyph was the other try; among these words it read as a badge
                  stuck on the label. */}
              {fast && <span className="text-muted-foreground/60">Fast</span>}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* One thing only. Effort has its own control inside the menu and names
            its own chord there, so listing both here made a tooltip that read
            as a menu of shortcuts — hence `max-w-none`, which the default
            `max-w-xs` would wrap. */}
        <TooltipContent side="top" className="max-w-none whitespace-nowrap">
          Switch model
          <ShortcutKeys ids={["model.next"]} />
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="start"
        // **`max-h` of its own, because Radix's cap is the whole window.** A
        // discovered list is 37 rows and grows with every provider the reader
        // connects, so without this the menu opens as a column taller than the
        // conversation behind it — which is what "gigante" was. Twenty-two rem
        // is about eleven rows: enough to read, short enough to stay a menu, and
        // the list scrolls inside it. `overscroll-contain` so a scroll that
        // reaches the end does not carry on into the transcript.
        className="max-h-[min(22rem,60vh)] w-auto min-w-[15rem] max-w-[22rem] overscroll-contain"
        // The trigger is also the tooltip trigger, so Radix returning focus to
        // it on close reopens the tooltip on that focus and leaves it stuck
        // until the next click. Don't refocus the trigger — the composer takes
        // focus back on its own.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* The way back to one model, and the only place the set is explained.
            Drawn only while there is a set, like every other row here that would
            otherwise say nothing. */}
        {canFanOut(fanOut) && (
          <>
            <DropdownMenuItem
              className="text-ui text-muted-foreground"
              onSelect={() => {
                clearFanOut(sessionId);
                setOpen(false);
              }}
            >
              Sending to {fanOut.length} models — back to one
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* The list is every model the provider serves — 37 of them on one
            opencode-go account — so it is searched rather than scanned.

            `onKeyDown` stops propagation, and that is load-bearing rather than
            tidiness: Radix binds its own typeahead to the menu content, so a
            character typed here would be read as "jump to the row starting with
            it" and the caret would leave the field on the first letter of the
            first search. */}
        {searchable && (
          <div className="flex h-8 items-center gap-2 px-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              placeholder="Search models"
              spellCheck={false}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => setQuery(event.currentTarget.value)}
              // The base input's own fill, border and ring are the dialog's
              // look rather than a menu row's, so all three are turned off —
              // `dark:bg-transparent` as well, since that rule is the more
              // specific one and a plain override reads as removed in source
              // while the fill stays on screen.
              className="h-full rounded-none border-0 bg-transparent p-0 text-ui shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        )}

        {/* Grouped only where a heading says something: a list can answer with
            models per provider, and a reader picking between two providers'
            models needs to know which is which. A one-provider list draws its
            rows flat, the heading naming what nothing disputes. */}
        {providerGroups.length > 1
          ? providerGroups.map((group) => (
              <div key={group.provider}>
                <p className="px-2 pt-1.5 pb-0.5 text-ui text-muted-foreground">
                  {group.provider}
                </p>
                {group.rows.map(modelRow)}
              </div>
            ))
          : searched.map(modelRow)}

        {/* The list is a *read* rather than a table on a discovered harness, so
            the picker can be open with nothing to draw while the probe is out.
            A row saying so holds the menu's shape and names the wait;
            collapsing to nothing and springing back is the glitch this
            replaces. Not a `DropdownMenuItem` — there is nothing to select, and
            one would take arrow focus. */}
        {searched.length === 0 && (
          <div className="flex flex-col items-start gap-2 px-2 py-1.5">
            <p className="text-ui text-muted-foreground">
              {models.length > 0
                ? `Nothing matches “${query}”.`
                : loadingModels
                  ? "Loading models…"
                  : "No models yet — the agent has no provider configured"}
            </p>
            {/* **The one empty state with a way out.** Nothing else in this app
                is a fresh install's dead end: every other control has a
                default, and this is the one the reader has to fill in. */}
            {!loadingModels && models.length === 0 && onOpenProviderSettings && (
              <Button variant="secondary" size="sm" onClick={onOpenProviderSettings}>
                Add a provider
              </Button>
            )}
          </div>
        )}

        {/* Straight under the models it qualifies, and above "More models",
            which is a *fold of the same list* — putting this between the list
            and its own continuation would read as the fold belonging to it.
            Inside this menu rather than beside it in the toolbar, since which
            models have a faster tier is what this menu is already about.

            A real switch and not a check: every other row here is a *pick* out
            of a set, where this is one thing on or off, and a tick that appears
            and disappears says that in half the space and none of the clarity.
            No glyph either — the rows above carry none, and one here would make
            this look like a model with a mark rather than a control. Drawn only
            where the harness *and* the model have one, so it is never a control
            that acks and changes nothing. */}
        {offersFast(harness, selected, isNewSession) && (
          <>
            <DropdownMenuItem
              className="cursor-pointer text-ui"
              // The row is the control and the switch is its picture: a `Switch`
              // that took its own click would fire beside this one and toggle
              // twice. So the state is stated here — `role`/`aria-checked` over
              // the item's own `menuitem` — and the track below is inert.
              role="switch"
              aria-checked={fast}
              // Held open, unlike every other row in this menu. A switch that
              // vanishes on the press never shows the reader which way it went,
              // and a second thought about it costs reopening the picker.
              onSelect={(e) => {
                e.preventDefault();
                onFastChange(!fast);
              }}
            >
              Fast mode
              <Switch checked={fast} tabIndex={-1} aria-hidden className="pointer-events-none ml-auto" />
            </DropdownMenuItem>

            {/* The harness's own sentence, verbatim — "Fast mode disabled ·
                usage credits exhausted" says the whole thing, so nothing here
                frames it. Under the switch only while the switch is on: it is
                there to explain a lit control that changed nothing, and beside
                an off one it would be a stale complaint about a setting the
                reader has already left. Not a `DropdownMenuItem` — there is
                nothing to pick, and one would take arrow focus on the way past
                the row it belongs to. */}
            {fastNote && fast && (
              <p className="px-2 pb-1.5 text-ui text-muted-foreground">{fastNote}</p>
            )}
          </>
        )}

        {/* A submenu rather than a second block under a heading, because the
            rows below are not a category the reader is choosing *between* —
            they are the ones they will not open this menu for. Shift+Tab's
            cycle skips exactly what lives here, which is the other half of
            keeping the chord short. */}
        {more.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-ui text-muted-foreground">
              More models
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>{more.map(modelRow)}</DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* No rule above it. The row is already a different shape to the models
            over it — muted, and the one thing in the menu carrying a glyph — so
            a line there drew a box round the difference rather than making it.

            The editor for the reader's stars, and the only thing it is for:
            every model here is pickable whether or not it is in the rotation, and
            the rotation is what leads the menu and what Shift+Tab cycles. A list of three
            models needs no such editor, which is why a written one has none. */}
        {discoveredList(harness) && (
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-ui text-muted-foreground"
            onSelect={() => setLibraryOpen(true)}
          >
            <Sliders className="size-3.5" />
            Star models…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>

      <ModelLibraryDialog
        open={libraryOpen}
        // Opening the library closed the menu (it opens from a menu item), so
        // closing it drops the reader back with nothing open — one star to set
        // and they have to reopen the picker to actually pick. Reopen the menu
        // on close, where the rotation is now leading.
        onOpenChange={(next) => {
          setLibraryOpen(next);
          if (!next) setOpen(true);
        }}
        models={models}
        rotation={rotation}
        onRotationChange={setChosenRotation}
        onRefresh={() => onRefreshModels?.()}
        loading={loadingModels}
      />
    </DropdownMenu>
  );
}
