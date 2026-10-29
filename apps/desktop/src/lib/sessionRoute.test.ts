import { describe, expect, it } from "vitest";

import { isHiddenSession, routeForSession } from "./sessionRoute";

const index = [
  { sessionId: "chat", purpose: null },
  { sessionId: "thread", purpose: "channel" },
  { sessionId: "cli", purpose: null },
];
const owners = new Set(["chat"]);

describe("which sessions open as a page", () => {
  it("opens an agent's own chat", () => {
    expect(routeForSession("chat", index, owners, true)).toEqual({ kind: "open" });
  });

  it("refuses a channel thread, however the route got there", () => {
    expect(routeForSession("thread", index, owners, true).kind).toBe("blocked");
    expect(routeForSession("thread", index, owners, false).kind).toBe("blocked");
  });

  it("refuses a session no agent owns once the roster has loaded", () => {
    expect(routeForSession("cli", index, owners, true).kind).toBe("blocked");
    expect(routeForSession("cli", index, owners, false).kind).toBe("open");
  });

  it("lets a session the index has not seen yet through", () => {
    expect(routeForSession("brand-new", index, owners, true)).toEqual({ kind: "open" });
  });

  it("calls only a session with a purpose hidden", () => {
    expect(isHiddenSession({ purpose: "channel" })).toBe(true);
    expect(isHiddenSession({ purpose: null })).toBe(false);
    expect(isHiddenSession(undefined)).toBe(false);
  });
});
