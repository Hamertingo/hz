import { describe, expect, it } from "vitest";

import { byBase, everyHidden, hiddenSet, rowShown, toggleHidden, visibleRows } from "@/lib/modelVisibility";
import type { Harness, Model, ModelId } from "@/types/events";

/// The one harness this build has, named once so a second one added later is a
/// compile error here rather than a silently passing test.
const MCODE: Harness = "mcode";

/// One row of the agent's list, with only the fields these rules read spelled
/// out. The rest are the shape a discovered list always has — no effort ladder
/// and no fast mode on mcode — so nothing here is a guess about a model.
function model(name: string, variant = "thinking"): Model {
  return {
    id: `m:custom_provider%3Aopencode-go:${name}:v:${variant}` as ModelId,
    label: name,
    efforts: [],
    defaultEffort: null,
    arg: `m:custom_provider%3Aopencode-go:${name}:v:${variant}`,
    provider: "custom_provider:opencode-go",
    acceptsImages: false,
    secondary: false,
    supportsFast: false,
    baseId: `m:custom_provider:opencode-go:${name}`,
    variant,
    // A discovered row: the agent states a window, and nothing here reads it, so
    // null is the honest spelling of "this fixture does not speak about it".
    contextWindow: null,
    maxTokens: null,
  };
}

const MODELS = [model("glm-5.3"), model("deepseek-v4.1-flash"), model("kimi-k3")];
const ids = MODELS.map((m) => m.id);

describe("hiddenSet", () => {
  /// **Nothing stored is nothing hidden.** The picker drew every model the agent
  /// serves before this preference existed and still does, so a fresh install has
  /// to read as "everything on" rather than as an empty list of the kept — which
  /// is what the field it replaced meant, and what inverted it.
  it("hides nothing where nothing has been chosen", () => {
    expect(hiddenSet(null).size).toBe(0);
  });

  it("carries the stored ids where there are some", () => {
    expect([...hiddenSet([ids[0]])]).toEqual([ids[0]]);
  });
});

describe("visibleRows", () => {
  it("draws everything the harness serves when nothing is hidden", () => {
    expect(visibleRows(MODELS, hiddenSet(null), MCODE).map((row) => row.key)).toEqual(
      MODELS.map((m) => m.baseId),
    );
  });

  /// The switch is the whole of it: a model that is off is not drawn, and its
  /// neighbours keep the agent's own order rather than closing the gap.
  it("drops the rows that are switched off, and only those", () => {
    const rows = visibleRows(MODELS, hiddenSet([MODELS[1].id]), MCODE);

    expect(rows.map((row) => row.variants[0].label)).toEqual(["glm-5.3", "kimi-k3"]);
  });

  /// Switching every model off draws an empty picker rather than falling back to
  /// everything, which is why the stored fact is a list of what is hidden and not
  /// a count of what is left.
  it("draws nothing where everything is switched off", () => {
    expect(visibleRows(MODELS, hiddenSet(ids), MCODE)).toEqual([]);
  });
});

describe("rowShown", () => {
  /// **A model is one row however many variants it has**, so a variant the agent
  /// adds later must not resurrect one the reader switched off.
  it("is off where any of a row's variants is off", () => {
    const row = byBase([model("glm-5.3", ""), model("glm-5.3", "thinking")])[0];

    expect(rowShown(row, hiddenSet(null))).toBe(true);
    expect(rowShown(row, hiddenSet([row.variants[1].id]))).toBe(false);
    expect(rowShown(row, hiddenSet(row.variants.map((m) => m.id)))).toBe(false);
  });
});

describe("toggleHidden", () => {
  /// A row is switched on or off on every variant of it at once: half of one
  /// would draw the model as off while the send could still reach the variant
  /// that was left on.
  it("switches a model rather than half of one", () => {
    const both = [`${MODELS[0].baseId}:v:`, `${MODELS[0].baseId}:v:thinking`] as ModelId[];

    expect(toggleHidden([], both)).toEqual(both);
    // Half hidden is not hidden: the row it draws says off, so it goes off.
    expect(toggleHidden([both[0]], both)).toEqual(both);
    expect(toggleHidden(both, both)).toEqual([]);
  });

  it("leaves the models it was not asked about alone", () => {
    expect(toggleHidden([ids[0]], [ids[1]])).toEqual([ids[0], ids[1]]);
    expect(toggleHidden(ids, [ids[1]])).toEqual([ids[0], ids[2]]);
  });
});

describe("everyHidden", () => {
  /// What decides whether the list's one button offers to hide the rest or to
  /// bring them back — and an empty list is neither, since a provider that
  /// reported no models has nothing to switch.
  it("answers for the rows it was given", () => {
    const rows = byBase(MODELS);

    expect(everyHidden(rows, hiddenSet(ids))).toBe(true);
    expect(everyHidden(rows, hiddenSet([ids[0]]))).toBe(false);
    expect(everyHidden([], hiddenSet(null))).toBe(false);
  });
});
