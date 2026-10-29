import { describe, expect, it } from "vitest";

import { agentIdFor, DEFAULT_LOOK, TEMPLATE_NAMES, TEMPLATES } from "./agentDraft";
import { EYES, MOUTHS, ACCS, PATS, SHAPE_NAMES } from "./face";
import { MASCOT_COLORS } from "./mascots";

describe("templates", () => {
  it("offers the eight the mockup offers, in its order", () => {
    expect(TEMPLATE_NAMES).toEqual(["Dev", "Marketer", "Scout", "Helper", "Ops", "Quill", "Guard", "Pal"]);
  });

  it("every template's face is parts the picker offers", () => {
    for (const t of TEMPLATES) {
      expect(SHAPE_NAMES).toContain(t.shape);
      expect(MASCOT_COLORS).toContain(t.color);
      expect(EYES).toContain(t.look.eyes);
      expect(MOUTHS).toContain(t.look.mouth);
      expect(ACCS).toContain(t.look.acc);
      expect(PATS).toContain(t.look.pat);
    }
  });

  it("the default look is one the picker offers", () => {
    expect(SHAPE_NAMES).toContain(DEFAULT_LOOK.shape);
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
