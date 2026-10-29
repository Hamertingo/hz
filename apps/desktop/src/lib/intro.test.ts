import { describe, expect, it } from "vitest";

import { INTRO_PROMPT, isIntro } from "./intro";

describe("intro", () => {
  it("marks the opening prompt and nothing a person would type", () => {
    expect(isIntro(INTRO_PROMPT)).toBe(true);
    expect(isIntro("Say hello")).toBe(false);
    expect(isIntro(` ${INTRO_PROMPT}`)).toBe(false);
  });
});
