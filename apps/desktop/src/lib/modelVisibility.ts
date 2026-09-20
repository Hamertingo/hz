import { readPreference } from "@/lib/prefs";
import { modelLabel } from "@/lib/model";
import type { Harness, Model, ModelId } from "@/types/events";

/// Which models the reader has switched off — a durable preference, so it is in
/// `~/.hz/settings.json` rather than the session index.
///
/// Not the session index because which models a reader works with is a fact about
/// the reader and not about any session: it has to be true in the composer before
/// a session exists, and it must not travel with a session handed to somebody
/// else.
///
/// **The stored list is the hidden half, and that direction is the whole of what
/// a new model does.** `null` — nothing stored — means nothing is hidden. A
/// provider being connected adds rows the reader has never seen, and a list of
/// what is *kept* would leave every one of them off, which reads as a model the
/// agent will run and the app refuses to offer. See `AppSettings::hidden_models`.
///
/// The key is deliberately not the one the old rotation used: that held the kept
/// half, so reading it here would invert it — the two models a reader named would
/// be the two that vanished.
export const HIDDEN_MODELS_KEY = "hz.hiddenModels";

/// Harnesses whose model list is *discovered* — read off the machine at runtime,
/// every model every provider the reader has connected — rather than written down
/// by hz.
///
/// It decides one thing: whether the list has a second tier to fold. A written
/// list is tiered and its second tier is `Model.secondary`; a discovered list is
/// not, so "More models" has nothing to hide.
const DISCOVERED: Harness[] = ["mcode"];

export function discoveredList(harness: Harness): boolean {
  return DISCOVERED.includes(harness);
}

/// One picker row: a single model, with every variant the harness serves for it.
///
/// **The reader's unit is the model, and the wire's unit is the variant.** mcode
/// answers 41 choices for 37 models — `<model> · thinking` for each, and two rows
/// for the one model it serves both ways — so the menu would otherwise read
/// `glm-5.3`, `glm-5.3` twice over for one idea. A row is where that is settled,
/// so the menu, the settings list and Shift+Tab's cycle all measure a model the
/// same way and none of them can stop halfway through one.
export type ModelRow = {
  /// What its variants share — `baseId` where the harness states one, the id
  /// where it does not. An empty `baseId` means the id is not a wire ref at all,
  /// and a harness whose list is already one row per model keys every row by its
  /// own id, which draws exactly as it did.
  key: string;
  /// The variants, in the order the list arrived in, the harness's own first.
  variants: Model[];
};

/// The key a model is grouped under — see [`ModelRow`].
function rowKey(model: Model): string {
  return model.baseId || model.id;
}

/// The rows a list makes, one per model, in the order the list arrived in.
///
/// Insertion order rather than sorting, the same bargain [`byProvider`] makes:
/// the agent's own order is a decision, and a picker that reordered itself under
/// the reader would move the row they were reaching for.
export function byBase(models: Model[]): ModelRow[] {
  const rows = new Map<string, ModelRow>();

  for (const model of models) {
    const key = rowKey(model);
    const row = rows.get(key);
    if (row) row.variants.push(model);
    else rows.set(key, { key, variants: [model] });
  }

  return [...rows.values()];
}

/// The model a row runs as, given what the session is already on.
///
/// The variant already chosen where there is one, so that arriving at a row the
/// session is running — from the chord, or from the trigger's own row — never
/// silently resets the switch it is standing on. Otherwise the harness's first,
/// since a pick has to name a variant and there is nothing else to prefer.
export function rowModel(row: ModelRow, current: ModelId): Model {
  return row.variants.find((m) => m.id === current) ?? row.variants[0];
}

/// The ids that are switched off.
export function hiddenSet(stored: ModelId[] | null): Set<ModelId> {
  return new Set(stored ?? []);
}

/// Whether a row is shown.
///
/// **Off if *any* of its variants is off**, which is the direction that cannot
/// let a model back in behind the reader: the switch is drawn for the model, and
/// a variant added by the agent later must not resurrect one that was switched
/// off. [`toggleHidden`] moves every variant together, so the two only disagree
/// in that case.
export function rowShown(row: ModelRow, hidden: ReadonlySet<ModelId>): boolean {
  return !row.variants.some((model) => hidden.has(model.id));
}

/// The rows the picker draws: everything the harness serves, minus what is off.
///
/// **The tier is still folded where a harness has one** — `Model.secondary` says
/// where a row is drawn rather than whether the reader wants it, so it is a
/// different rule from the switches and both apply.
export function visibleRows(
  models: Model[],
  hidden: ReadonlySet<ModelId>,
  harness: Harness,
): ModelRow[] {
  const listed = discoveredList(harness) ? models : models.filter((m) => !m.secondary);
  const drawn = new Set(listed.map(rowKey));

  return byBase(models).filter((row) => drawn.has(row.key) && rowShown(row, hidden));
}

/// What the picker folds into "More models". Empty for a discovered list, which
/// has no second tier of its own.
export function underMore(models: Model[], harness: Harness): ModelRow[] {
  return discoveredList(harness) ? [] : byBase(models.filter((m) => m.secondary));
}

/// The rows Shift+Tab walks: what is shown, plus the model the session is on.
///
/// Read at the moment of the press rather than held, which is the point — a chord
/// reading a stale list is the bug this exists to fix. The session's own model
/// rides along even where it is switched off, since a chord that skips the model
/// on screen reads as broken.
export function cycledModels(models: Model[], harness: Harness, current: ModelId): ModelRow[] {
  const hidden = hiddenSet(readPreference(HIDDEN_MODELS_KEY, null));
  const rows = visibleRows(models, hidden, harness);

  if (!hidden.has(current)) return rows;

  const onScreen = byBase(models).filter((row) =>
    row.variants.some((model) => model.id === current),
  );
  return [...rows, ...onScreen];
}

/// The row a model sits on, read off the **whole** list rather than the picker's
/// own list: the trigger names the model the session runs, and whether the
/// variant is worth naming is a fact about the model rather than about what the
/// menu happens to be drawing.
export function rowOf(models: Model[], id: ModelId): ModelRow | null {
  return byBase(models).find((row) => row.variants.some((m) => m.id === id)) ?? null;
}

/// The rows a query matches.
///
/// The query is asked of the **model** rather than of a variant: the two variants
/// of one model carry the same name, so a match on either draws the row whole —
/// variants and all — rather than one whose second choice has gone.
export function matchingRows(rows: ModelRow[], query: string): ModelRow[] {
  return rows.filter((row) => row.variants.some((m) => matchesQuery(m, query)));
}

/// The rows grouped under their provider, in the order the list arrived in.
///
/// Insertion order rather than alphabetical: mcode answers provider by provider,
/// so its own order already groups them, and sorting would move a heading the
/// reader had just found.
export function byProvider(rows: ModelRow[]): { provider: string; rows: ModelRow[] }[] {
  const groups: { provider: string; rows: ModelRow[] }[] = [];

  for (const row of rows) {
    const provider = row.variants[0].provider;
    const group = groups.find((g) => g.provider === provider);
    if (group) group.rows.push(row);
    else groups.push({ provider, rows: [row] });
  }

  return groups;
}

/// Flips a **model's** switch: every variant on where they are all off, every one
/// off otherwise.
///
/// All of them at once because the row is one model, and half of one would draw
/// the model as switched off while the send could still reach the variant that
/// was left on — the picker's own list is a set of ids, so nothing else would
/// notice the half.
export function toggleHidden(hidden: ModelId[], ids: ModelId[]): ModelId[] {
  const off = new Set(hidden);
  const all = ids.every((id) => off.has(id));

  for (const id of ids) {
    if (all) off.delete(id);
    else off.add(id);
  }

  return [...off];
}

/// Whether every model a reader can see is switched off — which is what decides
/// whether the list's one button offers to hide the rest or to bring them back.
export function everyHidden(rows: ModelRow[], hidden: ReadonlySet<ModelId>): boolean {
  return rows.length > 0 && rows.every((row) => !rowShown(row, hidden));
}

/// **Case-insensitive substring, over everything on the row a reader can see plus
/// the id underneath it.**
///
/// The id is searched because it is what `hz new --model` takes and what an error
/// names, so somebody arriving with one in hand can find its row. The drawn name
/// is searched as well as the label, since the two differ by exactly the
/// separators a reader is likely to type as spaces: `minimax m3` has to find the
/// row drawn `Minimax M3`.
export function matchesQuery(model: Model, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  return (
    model.label.toLowerCase().includes(q) ||
    modelLabel(model.label).toLowerCase().includes(q) ||
    model.provider.toLowerCase().includes(q) ||
    model.id.toLowerCase().includes(q)
  );
}
