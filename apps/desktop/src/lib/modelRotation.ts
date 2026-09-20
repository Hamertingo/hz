import { readPreference } from "@/lib/prefs";
import { modelLabel } from "@/lib/model";
import type { Harness, Model, ModelId } from "@/types/events";

/// Where the reader's model rotation lives — a durable preference, so it is in
/// `~/.hz/settings.json` rather than the session index.
///
/// Not the session index because which models a reader works with is a fact about
/// the reader and not about any session: it has to be true in the composer before
/// a session exists, and it must not travel with a session handed to somebody
/// else.
///
/// **`null` is "never chosen", and that means every model** — see
/// [`modelRotation`]. The key is deliberately not the one the old shortlist used:
/// a stored shortlist read as a rotation claims the opposite thing, so that value
/// is left where it is rather than reinterpreted.
export const MODEL_ROTATION_KEY = "hz.modelRotation";

/// Harnesses whose model list is *discovered* — read off the machine at runtime,
/// every model every provider the reader has logged into serves — rather than
/// written down by hz.
///
/// It decides two things, and neither is what the picker draws:
///
/// **The picker has nothing to fold.** A written list is tiered, and its second
/// tier is `Model.secondary`; a discovered list is not, so "More models" has no
/// contents to hide. And it is long enough to need a search field over it, which
/// is the second thing.
///
/// **The stars need an editor.** With 41 models in a menu, the ones a reader
/// keeps are worth marking off — see [`cycledModels`] — and that is
/// what the library dialog is for. A harness with four models needs no such
/// thing.
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
/// so the menu, the library dialog and Shift+Tab's cycle all measure a model the
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

/// The rows the picker draws at its top level: **every model the harness
/// serves**, the reader's stars first.
///
/// All of them, because a model the agent will run is a model the picker has to
/// offer. The shortlist this used to draw meant a model was reachable only after
/// being starred in the library dialog — a hunt through a second surface rather
/// than a picker, and 37 models of one provider behind it. What is left of that
/// list is a star's other job: it leads the menu, which is also what makes the
/// chord's cycle the top of what the reader can see (see [`cycledModels`]).
///
/// **Which models are drawn is decided first and the rows are cut after**, so a
/// star draws the model whole: the variant the reader starred and the one they
/// did not are one row, and the second is not a second thing to star.
///
/// The `secondary` tier is still folded away where a harness has one — a
/// different rule, since it says where a row is *drawn* rather than what the
/// reader has starred.
/// **The models in the reader's rotation, resolved against the list.**
///
/// `null` — nothing stored yet, which is every install that has never opened the
/// library — means *all of them*, and that is the default rather than an empty
/// shortlist. The picker draws every model the agent serves, so a switch reading
/// off beside a model the app is happily running is a lie about what is
/// available; what the switch actually decides is which models the menu leads
/// with and which set ⇧Tab cycles, and on a fresh install that is everything.
/// Turning one off is how a reader shortens that cycle, and it stores the whole
/// remaining list — an explicit answer, never "nothing chosen".
export function modelRotation(models: Model[], stored: ModelId[] | null): ModelId[] {
  return stored ?? models.map((model) => model.id);
}

/// The rows the picker draws, the reader's rotation leading.
export function topLevel(models: Model[], starred: ModelId[], harness: Harness): ModelRow[] {
  const listed = discoveredList(harness) ? models : models.filter((m) => !m.secondary);
  const drawn = new Set(listed.map(rowKey));
  const rows = byBase(models).filter((row) => drawn.has(row.key));
  const starredKeys = new Set(listed.filter((m) => starred.includes(m.id)).map(rowKey));

  // Two passes rather than a sort: a sort would need a tiebreak to hand the
  // agent's own order back, and that order is what the reader has been reading.
  return [
    ...rows.filter((row) => starredKeys.has(row.key)),
    ...rows.filter((row) => !starredKeys.has(row.key)),
  ];
}

/// What the picker folds into "More models". Empty for a discovered list, which
/// has no second tier of its own.
export function underMore(models: Model[], harness: Harness): ModelRow[] {
  return discoveredList(harness) ? [] : byBase(models.filter((m) => m.secondary));
}

/// The rows Shift+Tab walks: the reader's stars, plus the model the session is on.
///
/// The rotation rather than the picker's whole list, and this is what keeps the chord
/// worth having now that the menu draws everything: 37 rows is 37 presses to
/// nowhere. The rotation is the reader saying "these are the ones I switch
/// between" —
/// and the session's own model rides along, since a chord that skips the model
/// on screen is a chord that reads as broken.
///
/// The rotation leads the menu, so the cycle is the top of what the picker draws: a
/// press can never land on a model the menu does not show. Read at the moment of
/// the press rather than held, which is the point — a chord reading a stale list
/// is the bug this exists to fix.
export function cycledModels(models: Model[], harness: Harness, current: ModelId): ModelRow[] {
  const stored = readPreference(MODEL_ROTATION_KEY, null);
  const cycle = new Set([...modelRotation(models, stored), current]);

  return topLevel(models, modelRotation(models, stored), harness).filter((row) =>
    row.variants.some((m) => cycle.has(m.id)),
  );
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
/// The query is asked of the **model** rather than of a variant: the two
/// variants of one model carry the same name, so a match on either draws the row
/// whole — variants and all — rather than one whose second choice has gone.
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

/// Flips a **model's** stars: every variant off where all of them are on, every
/// one on otherwise.
///
/// All of them at once because the row is one model, and a star on half of one
/// would draw it in the picker carrying a switch that says it is off — the
/// picker's own list is a set of ids, so nothing else would notice the half.
export function toggleRotation(starred: ModelId[], ids: ModelId[]): ModelId[] {
  const stars = new Set(starred);
  const all = ids.every((id) => stars.has(id));

  for (const id of ids) {
    if (all) stars.delete(id);
    else stars.add(id);
  }

  return [...stars];
}

/// Case-insensitive substring, over everything on the row a reader can see plus
/// the id underneath it.
///
/// The id is searched because it is what `hz new --model` takes and what an
/// error names, so somebody arriving with one in hand can find its row. The
/// drawn name is searched as well as the label, since the two differ by exactly
/// the separators a reader is likely to type as spaces: `minimax m3` has to find
/// the row drawn `Minimax M3`.
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
