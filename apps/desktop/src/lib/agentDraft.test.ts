import { describe, expect, it } from "vitest";

import { agentIdFor, DEFAULT_LOOK, TEMPLATE_NAMES, TEMPLATES } from "./agentDraft";
import { MASCOT_COLORS, MASCOT_KINDS } from "./mascots";

describe("templates", () => {
  it("offers the six the mockup offers, Blank first", () => {
    expect(TEMPLATE_NAMES).toEqual(["Blank", "Developer", "Researcher", "Writer", "Reviewer", "Strategist"]);
  });

  it("Blank fills nothing, so the reader's own text stays", () => {
    expect(TEMPLATES.Blank).toEqual({});
  });

  it("every template's face and colour are ones the picker offers", () => {
    for (const name of TEMPLATE_NAMES) {
      const t = TEMPLATES[name];
      if (t.kind) expect(MASCOT_KINDS).toContain(t.kind);
      if (t.color) expect(MASCOT_COLORS).toContain(t.color);
    }
  });

  it("the default look is one the picker offers", () => {
    expect(MASCOT_KINDS).toContain(DEFAULT_LOOK.kind);
    expect(MASCOT_COLORS).toContain(DEFAULT_LOOK.color);
  });
});

describe("agentIdFor", () => {
  it("slugs the name to letters and digits", () => {
    expect(agentIdFor("Ação Beta 2", new Set())).toBe("acaobeta2");
  });

  it("falls back to agent when nothing usable is left", () => {
    expect(agentIdFor("🙂", new Set())).toBe("agent");
  });

  it("suffixes a second agent with the same name", () => {
    const taken = new Set(["atlas"]);
    expect(agentIdFor("Atlas", taken)).toBe("atlas2");
    expect(agentIdFor("Atlas", new Set(["atlas", "atlas2"]))).toBe("atlas3");
  });
});
