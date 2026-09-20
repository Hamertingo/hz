import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/// These tests run in the node environment like every other one here, so there
/// is no `localStorage` and no bridge: both are stood up by hand.
///
/// The store is *module* state — what the file held, whether it has been read —
/// so a static import would leave one test's launch behind for the next, and a
/// statically imported helper would be holding a *different* copy of the store
/// than the module under test. Each test therefore clears the module registry
/// and imports again, which is the one thing `await import` is for here.
///
/// What these are here to pin is the **move**: a reader upgrading hz has their
/// picks in the webview and none in `settings.json`, and every rule below is one
/// that either carries them across or refuses to lose them.
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

/// The webview's store, as a `Map` of the JSON it holds.
const webview = new Map<string, string>();

/// A settings payload as `get_preferences` answers one: every field named, the
/// ones the file says nothing about as `null`.
function file(named: Record<string, unknown> = {}) {
  return {
    composerPrefs: null,
    starredModels: null,
    shortcuts: null,
    updateChannel: null,
    openWith: null,
    openFileWith: null,
    runInTerminal: null,
    space: null,
    spaces: null,
    ...named,
  };
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === "get_preferences" ? file() : file(),
  );

  webview.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => webview.get(key) ?? null,
      setItem: (key: string, value: string) => void webview.set(key, value),
      removeItem: (key: string) => void webview.delete(key),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

/// What `main.tsx` does at launch: a settings payload, then the read, then the
/// move. The file the payload came from is named by `named`.
async function launch(copies: Record<string, unknown>, named: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries(copies)) webview.set(key, JSON.stringify(value));
  invoke.mockImplementation(async (command: string) =>
    command === "get_preferences" ? file(named) : file(named),
  );

  vi.resetModules();
  const prefs = await import("@/lib/prefs");
  await prefs.loadPreferences();
  await prefs.adoptDurablePreferences();

  return prefs;
}

describe("adoptDurablePreferences", () => {
  it("moves a pick the webview still holds and lets the copy go", async () => {
    const prefs = await launch({ "hz.modelRotation": ["opus"], "hz.space": "work" });

    expect(invoke).toHaveBeenLastCalledWith("set_preferences", {
      patches: [
        { field: "modelRotation", value: ["opus"] },
        { field: "space", value: "work" },
      ],
    });
    expect(webview.has("hz.modelRotation")).toBe(false);
    expect(webview.has("hz.space")).toBe(false);
    expect(prefs.readPreference("hz.space", null)).toBe("work");
    expect(prefs.readPreference("hz.modelRotation", [])).toEqual(["opus"]);
  });

  /// The whole of the idempotence argument: the copy is removed only after the
  /// write landed, so a second run has nothing to move — which is also why a
  /// run that failed is safe to repeat.
  it("moves nothing the second time", async () => {
    const prefs = await launch({ "hz.space": "work" });
    invoke.mockClear();

    await prefs.adoptDurablePreferences();

    expect(invoke).not.toHaveBeenCalled();
    expect(prefs.readPreference("hz.space", null)).toBe("work");
  });

  /// A launch that was interrupted between the write and the removal, or a
  /// reader who has picked since: the file is the newer answer either way, and
  /// the stale copy is dropped rather than written back over it.
  it("keeps what the file already answers for, and drops the stale copy", async () => {
    const prefs = await launch({ "hz.space": "old" }, { space: "work" });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_preferences");
    expect(webview.has("hz.space")).toBe(false);
    expect(prefs.readPreference("hz.space", null)).toBe("work");
  });

  /// Nothing is removed until the write lands, so a backend that cannot take the
  /// picks leaves them where they are — this session reads them from the copy,
  /// and the next launch tries the same move again.
  it("keeps the copy where the write did not land", async () => {
    webview.set("hz.space", JSON.stringify("work"));
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_preferences") return file();
      throw new Error("settings.json is not writable");
    });
    vi.resetModules();
    const prefs = await import("@/lib/prefs");

    await prefs.loadPreferences();
    await prefs.adoptDurablePreferences();

    expect(webview.get("hz.space")).toBe(JSON.stringify("work"));
    expect(prefs.readPreference("hz.space", null)).toBe("work");
  });

  /// A read has to answer before the launch has finished, because that is what
  /// the move is: the first launch after it finds the picks in the webview and
  /// nothing in the file, and a default for one of those frames would be a
  /// setting the reader has, gone.
  it("answers from the copy until the file has been read", async () => {
    webview.set("hz.updateChannel", JSON.stringify("beta"));
    vi.resetModules();
    const prefs = await import("@/lib/prefs");

    expect(prefs.readPreference("hz.updateChannel", "stable")).toBe("beta");
  });

  it("answers from the file once it has been read, whatever the copy says", async () => {
    const prefs = await launch({ "hz.updateChannel": "beta" }, { updateChannel: "stable" });

    expect(prefs.readPreference("hz.updateChannel", "stable")).toBe("stable");
    expect(webview.has("hz.updateChannel")).toBe(false);
  });
});

describe("writePreference", () => {
  it("stores one change as one patch, and reads it back at once", async () => {
    const prefs = await launch({});

    prefs.writePreference("hz.spaces", ["work", "home"]);

    expect(invoke).toHaveBeenLastCalledWith("set_preferences", {
      patches: [{ field: "spaces", value: ["work", "home"] }],
    });
    expect(prefs.readPreference("hz.spaces", [])).toEqual(["work", "home"]);
  });

  /// `null` is how a preference is cleared — the active space going away when
  /// the last thing filed under it is renamed out — so it has to travel as a
  /// value rather than as an omission.
  it("sends a cleared preference as a patch that names it", async () => {
    const prefs = await launch({}, { space: "work" });

    prefs.writePreference("hz.space", null);

    expect(invoke).toHaveBeenLastCalledWith("set_preferences", {
      patches: [{ field: "space", value: null }],
    });
    expect(prefs.readPreference("hz.space", null)).toBeNull();
  });
});

/// The helpers a plain module reads and writes through, which is how
/// `useSessions`' `canAnnounce` asks which space is up — outside React, on a
/// listener registered once. A moved key answered from the wrong store there is
/// a space that is up reading as no space at all, so the delegation is pinned
/// rather than left to the call site that cannot be changed.
describe("the webview helpers", () => {
  it("answer a moved key from the store, and store through it", async () => {
    const prefs = await launch({ "hz.space": "work" });
    const { readLocalStorage, writeLocalStorage } = await import("@/hooks/useLocalStorage");

    expect(readLocalStorage<string | null>("hz.space", null)).toBe("work");

    writeLocalStorage("hz.space", "home");

    expect(prefs.readPreference("hz.space", null)).toBe("home");
    expect(webview.has("hz.space")).toBe(false);
  });

  /// And a key that stayed is still the webview's, which is what keeps the two
  /// stores from bleeding into each other.
  it("keep a key that stayed in the webview", async () => {
    await launch({});
    const { readLocalStorage, writeLocalStorage } = await import("@/hooks/useLocalStorage");

    writeLocalStorage("hz.diffStyle", "unified");

    expect(webview.get("hz.diffStyle")).toBe(JSON.stringify("unified"));
    expect(readLocalStorage("hz.diffStyle", "split")).toBe("unified");
  });
});
