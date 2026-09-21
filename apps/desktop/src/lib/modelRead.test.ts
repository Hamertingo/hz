import { describe, expect, it } from "vitest";

import { modelsWaiting } from "./modelRead";

/// Every state the composer's boot can be in, as the read sees it. The four
/// flags are not independent in the app — a park is only made once the project
/// list has landed, and only for a prompt that will create a session — so the
/// rows below are the reachable combinations, not the cross product.
const base = {
  selectedSessionId: null,
  projectsSettled: true,
  targetPath: "/repo",
  parkLanded: false,
};

describe("modelsWaiting", () => {
  it("holds the read while a park for a project is inbound", () => {
    // The whole reason this exists: the park is booting the same child this read
    // would boot a second of.
    expect(modelsWaiting(base)).toBe(true);
  });

  it("releases it once the park has landed, landed or failed alike", () => {
    expect(modelsWaiting({ ...base, parkLanded: true })).toBe(false);
  });

  it("holds it until the project list lands, even with no target yet", () => {
    // "No target" and "not asked yet" are the same two fields until the list
    // arrives, and going early here is the launch-frame probe.
    expect(modelsWaiting({ ...base, projectsSettled: false, targetPath: null })).toBe(
      true,
    );
    expect(modelsWaiting({ ...base, projectsSettled: false, parkLanded: true })).toBe(
      true,
    );
  });

  it("goes at once when there is no project to park for", () => {
    // The one case the backend's own probe is the only answer to.
    expect(modelsWaiting({ ...base, targetPath: null })).toBe(false);
  });

  it("goes at once for a session that already exists", () => {
    // Nothing is being created, so nothing is being parked — a resume re-opens
    // its own child instead.
    expect(
      modelsWaiting({ ...base, selectedSessionId: "s1", projectsSettled: false }),
    ).toBe(false);
  });
});
