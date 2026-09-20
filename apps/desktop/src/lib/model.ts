import type { Effort, Harness, Model, ModelId } from "@/types/events";

/// The one spelling of "nothing here can name the model".
///
/// Written by an index entry made before the model was known, and by an older
/// build that read an id it did not recognise. `models.rs` holds the same
/// constant and normalises the older `"unknown"` onto it on the way in, so this
/// is the only spelling that reaches the frontend.
///
/// **Never drawn.** It is not a model name and there is no name to draw — a
/// surface holding one shows the picker's own placeholder instead.
export const UNSET_MODEL = "" as ModelId;

export function isUnsetModel(id: ModelId): boolean {
  return id === UNSET_MODEL;
}

/// What each harness opens on before its reader has picked anything, and what a
/// session indexed without a model reads back as.
///
/// Mirrors `default_model_for` in `models/models.rs` — two readers that cannot
/// call each other, so the rule is stated twice.
///
/// **mcode names none, and that is the honest answer rather than a gap.** It is
/// multi-provider — a managed account's models and every BYOK provider the
/// reader has configured — so any constant here might name a model they have no
/// key for. The CLI's own settings already say which one they want, and the
/// composer reads that back instead of seeding it.
export const DEFAULT_MODEL_FOR: Record<Harness, ModelId> = {
  mcode: UNSET_MODEL,
};

/// Which model each harness was last left on. Absent key = never picked one.
export type ModelByHarness = Partial<Record<Harness, ModelId>>;

/// The model to open a harness on: what it was last left on, else its default.
///
/// Per-harness because a model belongs to exactly one of them, so a single
/// remembered pick can only ever be right for the harness that made it.
/// Remembering one for both used to land a switch on whichever model the new
/// list happened to start with — a pick nobody made, and one that read as the
/// composer forgetting.
export function rememberedModel(remembered: ModelByHarness, harness: Harness): ModelId {
  return remembered[harness] ?? DEFAULT_MODEL_FOR[harness];
}

/// The model to run, given a pick and the list the current harness can run.
///
/// A model belongs to exactly one harness, so a pick made under another one
/// names something this harness cannot run — and the pick is stored, so it
/// outlives the switch that made it. Every place that seeds the composer's
/// model has to ask this: repairing only where the harness *changes* leaves the
/// stored default free to name the old harness's model forever, and it reaches
/// the backend as a session started on a model nobody chose.
///
/// An empty list means the models have not arrived yet, so the pick stands —
/// the fetch that fills the list repairs it a beat later.
///
/// A pick it has to replace falls to the harness's default, not to whatever
/// leads the list: the head of the list is a picker-ordering decision, and
/// reading it as an answer is what put sessions on a model nobody chose.
export function usableModel(models: Model[], picked: ModelId, harness: Harness): ModelId {
  if (models.length === 0 || models.some((m) => m.id === picked)) return picked;

  const fallback = DEFAULT_MODEL_FOR[harness];

  // mcode names no default, so this answers the unset sentinel rather than the
  // head of the list: the spawn then omits `--model` and the CLI uses whatever
  // its own settings say. Landing on the list's first model instead would put
  // a session on a model the reader never chose, with nothing on screen saying
  // so. The same answer for a model whose provider was logged out since, and
  // for one recorded by a build that ran a different harness.
  if (isUnsetModel(fallback)) return UNSET_MODEL;

  return models.some((m) => m.id === fallback) ? fallback : models[0].id;
}

/// The effort a model will actually run at, given what the reader last picked
/// for it.
///
/// A remembered pick outlives the answer that made it offerable, and mcode is
/// where that bites: its ladder is per model and only a session states it, so a
/// level picked while one model was selected can stop being offered the moment
/// another is — which is why the level is checked against the model on screen
/// rather than sent on trust. Left unchecked, the trigger names a level the
/// menu beside it no longer offers, and the next send asks for it again.
///
/// A model that takes no effort answers `null`, which is what hides the control
/// entirely. Otherwise the first offered level of: the pick, the model's own
/// default, the app's — [`usableModel`]'s own rule, that a pick which cannot be
/// honoured falls to a *default* rather than to whatever happens to sit nearest
/// it in the list. Only where none of the three is offered does the shape of
/// the ladder decide, and then it is the **top** rung: the app default is
/// already near the top, so a ladder missing it is a short one, and the top of
/// a short ladder is closer to what was asked than its floor.
export function usableEffort(
  model: Model,
  remembered: Effort | null,
  fallback: Effort,
): Effort | null {
  if (model.efforts.length === 0) return null;
  for (const wanted of [remembered, model.defaultEffort, fallback]) {
    if (wanted && model.efforts.includes(wanted)) return wanted;
  }
  return model.efforts[model.efforts.length - 1];
}

/// The spelling ACP addresses a model by: `m:<provider>:<model>`, with a
/// `:v:<variant>` tail where the model is served in more than one variant. The
/// same marker `ModelRef::parse` in `harness/mcode/parser.rs` reads, and the only
/// thing about a ref this side needs to know.
const WIRE_PREFIX = "m:";
const VARIANT_MARKER = ":v:";

/// The model's own part of a wire ref: prefix, provider and variant taken off.
///
/// Mirrors that same Rust parse, and has to: **a provider's own name can carry a
/// `:`** — `custom_provider:opencode-go` — which mcode escapes as `%3A` on the
/// wire, so the provider is everything up to the first colon and the variant is
/// matched from the end. The provider is dropped rather than drawn: it names who
/// serves the model, and the picker draws it as the row's own heading.
function nameInRef(ref: string): string {
  const rest = ref.slice(WIRE_PREFIX.length);
  const marker = rest.lastIndexOf(VARIANT_MARKER);
  const head = marker === -1 ? rest : rest.slice(0, marker);
  const separator = head.indexOf(":");

  return (separator === -1 ? head : head.slice(separator + 1)).replace(/%3A/gi, ":");
}

/// Words, capitalised — the first letter only. `MiniMax-M3` is already spelled
/// the way its maker spells it, so lowercasing the rest of a word is what would
/// mangle a name that already reads as prose; `deepseek-v4.1-flash` has nothing
/// to lose and gains its capitals.
///
/// A separator becomes a space, **except a dot between two digits**, which is
/// the version it belongs to: `v4.1` is one word and `-` is the break in it.
function prettify(name: string): string {
  return name
    .replace(/[._-]/g, (char: string, at: number, whole: string) =>
      char === "." && /\d/.test(whole[at - 1] ?? "") && /\d/.test(whole[at + 1] ?? "")
        ? "."
        : " ",
    )
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/// The name a model is drawn by, from however much the app knows about it.
///
/// Two folds, and both carry weight:
///
/// **A wire ref is not a name.** `label` is the agent's own words where it has
/// them — but mcode repeats the *value* as the row's name when the agent states
/// none, and the composer's trigger falls back to the id itself while the model
/// list is still being read, so
/// `m:custom_provider%3Aopencode-go:deepseek-v4.1-flash:v:thinking` reaches the
/// screen on the ordinary path of a slow probe. That string is addressing: the
/// prefix, the provider and the variant all name the *route* to the model, and
/// the picker draws the variant as a control of its own. What is left is the
/// model.
///
/// **Then it is prettified**, because an id is spelled for a parser and a name
/// is read by a person. Presentation only: `Model.id` and `Model.arg` are what
/// a pick sends, and neither is touched by this.
export function modelLabel(raw: string): string {
  return prettify(modelSlug(raw));
}

/// The agent's own spelling of a model, folded no further than out of the wire.
///
/// [`modelLabel`] is this with the capitals put on. The split exists for the one
/// reader that matches on the *name* rather than reading it — the brand table,
/// which keys off a vendor prefix and must see `deepseek-v4.1-flash` as the
/// agent spelled it rather than as a sentence.
export function modelSlug(raw: string): string {
  return raw.startsWith(WIRE_PREFIX) ? nameInRef(raw) : raw;
}
