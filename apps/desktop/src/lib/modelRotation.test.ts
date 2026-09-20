import { describe, expect, it } from "vitest";

import { modelRotation } from "@/lib/modelRotation";
import type { Model, ModelId } from "@/types/events";

/// One row of the agent's list, with only the fields this rule reads spelled
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
  };
}

const MODELS = [model("glm-5.3"), model("deepseek-v4.1-flash"), model("kimi-k3")];

describe("modelRotation", () => {
  /// The reader's rotation starts as *everything*. The picker draws every model
  /// the agent serves whatever this says, so an empty shortlist on a fresh
  /// install would read as a library with every switch off beside a picker that
  /// is happily offering all of them.
  it("keeps every model where nothing has been chosen", () => {
    expect(modelRotation(MODELS, null)).toEqual(MODELS.map((m) => m.id));
  });

  /// **And an empty list is not that case.** A reader who switched every model
  /// off has said something, and reading it as "nothing chosen" would turn the
  /// last switch back on under their hand — which is why the stored fact is
  /// `null` where an empty array is a real answer.
  it("keeps nothing where the reader turned everything off", () => {
    expect(modelRotation(MODELS, [])).toEqual([]);
  });

  it("answers the stored list itself once there is one", () => {
    const chosen = [MODELS[2].id, MODELS[0].id];

    expect(modelRotation(MODELS, chosen)).toEqual(chosen);
  });
});
