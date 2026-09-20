import { describe, expect, it, vi } from "vitest";

import type { Provider } from "@/types/events";

/// The store is module-level and outlives a test, so each case starts from a
/// fresh record rather than from whatever the one before it remembered — the
/// same `vi.resetModules` `prefs.test.ts` uses for its own module store.
async function fresh() {
  vi.resetModules();
  return import("@/lib/providerNames");
}

function provider(providerId: string, name: string): Provider {
  return {
    providerId,
    name,
    kind: "custom",
    active: false,
    enabled: true,
    readOnly: false,
    hasApiKey: true,
    models: [],
  };
}

describe("providerLabel", () => {
  /// **The fallback is the id's own slug**, because the picker draws a heading
  /// over each group and an id is not a name anybody reads:
  /// `custom_provider:opencode-go` is OpenCode Go's.
  it("reads a name off the id's last segment where nothing is known", async () => {
    const { providerLabel } = await fresh();

    expect(providerLabel("custom_provider:opencode-go", {})).toBe("Opencode Go");
    expect(providerLabel("custom_provider:command-code", {})).toBe("Command Code");
    expect(providerLabel("minimax", {})).toBe("Minimax");
  });

  /// The real name wins once `provider list` has been read — which is the one
  /// place the pair exists, since a model on the wire carries the id and nothing
  /// else.
  it("prefers the name the agent reports", async () => {
    const { providerLabel } = await fresh();

    expect(
      providerLabel("custom_provider:opencode-go", {
        "custom_provider:opencode-go": "OpenCode Go",
      }),
    ).toBe("OpenCode Go");
  });
});

describe("rememberProviderNames", () => {
  it("wakes a subscriber for a new reading and not for the same one", async () => {
    const { knownProviderNames, rememberProviderNames, subscribeProviderNames } = await fresh();

    let seen = 0;
    subscribeProviderNames(() => {
      seen += 1;
    });

    rememberProviderNames([provider("custom_provider:opencode-go", "OpenCode Go")]);
    expect(seen).toBe(1);

    // The same reading again is not news, and waking every picker on it would be
    // one re-render per settings read.
    rememberProviderNames([provider("custom_provider:opencode-go", "OpenCode Go")]);
    expect(seen).toBe(1);

    rememberProviderNames([provider("custom_provider:opencode-go", "OpenCode Go Edition")]);
    expect(seen).toBe(2);
    expect(knownProviderNames()["custom_provider:opencode-go"]).toBe("OpenCode Go Edition");
  });

  /// Merged rather than replaced: a provider removed since the last read keeps
  /// its name, so a session still on one of its models draws a heading rather
  /// than an id.
  it("keeps the names a later reading does not mention", async () => {
    const { knownProviderNames, rememberProviderNames } = await fresh();

    rememberProviderNames([provider("custom_provider:command-code", "Command Code")]);
    rememberProviderNames([provider("custom_provider:opencode-go", "OpenCode Go")]);

    expect(knownProviderNames()).toEqual({
      "custom_provider:command-code": "Command Code",
      "custom_provider:opencode-go": "OpenCode Go",
    });
  });
});
