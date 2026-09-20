import { describe, expect, it } from "vitest";

import { modelBrand } from "@/lib/modelBrand";

describe("modelBrand", () => {
  /// The slug is what is asserted rather than the path data: the geometry is the
  /// icon set's, and a test pinning it would fail on their next redraw.
  it("reads the vendor off the model's own name", () => {
    expect(modelBrand("deepseek-v4.1-flash").slug).toBe("deepseek");
    expect(modelBrand("kimi-k2.7-code").slug).toBe("kimi");
    expect(modelBrand("qwen3.8-max").slug).toBe("qwen");
    expect(modelBrand("minimax-m2.7").slug).toBe("minimax");
    expect(modelBrand("longcat-2.0").slug).toBe("longcat");
    // GLM is Zhipu AI's, which is the mark that carries it.
    expect(modelBrand("glm-5.3").slug).toBe("zhipu");
    expect(modelBrand("grok-4.5").slug).toBe("grok");
    expect(modelBrand("gpt-5.6-luna").slug).toBe("openai");
  });

  it("draws something for every vendor it names", () => {
    for (const name of ["deepseek-flash", "glm-5", "grok-4.6", "gpt-5.6-luna"]) {
      expect(modelBrand(name).paths.length).toBeGreaterThan(0);
    }
  });

  /// The provider is a gateway — one opencode-go entry serves five vendors — so a
  /// row must not take its mark from there. Matching on the model is what makes
  /// this work at all.
  it("does not take the mark from the provider", () => {
    expect(modelBrand("custom_provider:opencode-go").paths).toEqual([]);
  });

  /// A wire ref reaches this through the composer's trigger while the model list
  /// is still being read, so the fold has to happen here as well as in the label.
  it("folds a wire ref down to the model", () => {
    expect(
      modelBrand("m:custom_provider%3Aopencode-go:deepseek-v4.1-flash:v:thinking").slug,
    ).toBe("deepseek");
  });

  /// No mark is not no tile: the vendor's own initial stands in, which is what
  /// keeps the column even down a list where half the vendors are missing.
  ///
  /// `hy`, `mimo`, `muse` and `omen` are the live cases — nobody here can name
  /// the vendor behind those ids, and a mark is a claim about who serves the
  /// model, so they get the claim-free letter.
  it("answers a vendor's initial where there is no mark", () => {
    expect(modelBrand("hy3")).toEqual({ paths: [], slug: "", initial: "H" });
    // MiMo is Xiaomi's, and the set spells it `xiaomimimo` — one icon that a
    // search for either half of the name misses.
    expect(modelBrand("mimo-v2-pro").slug).toBe("xiaomimimo");
    expect(modelBrand("muse-spark-1.3-contributor")).toEqual({
      paths: [],
      slug: "",
      initial: "M",
    });
    expect(modelBrand("omen-alpha")).toEqual({ paths: [], slug: "", initial: "O" });
  });

  /// Nothing to read a name off — a nameless ref, or a pick the agent no longer
  /// serves — still fills the tile rather than leaving a hole in the column.
  it("always answers something", () => {
    expect(modelBrand("").initial).toBe("?");
    expect(modelBrand("m::").initial).toBe("?");
  });
});
