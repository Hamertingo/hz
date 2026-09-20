import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissSlow, slowRequest, tracked } from "@/lib/slow";

/// A promise this test decides when to settle, so a read can be held past the
/// threshold without any real waiting.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing here waits on the rejection, so it must not read as unhandled.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

describe("slow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dismissSlow();
  });

  afterEach(() => {
    dismissSlow();
    vi.useRealTimers();
  });

  /// The common case, and the reason the line is worth having at all: it must not
  /// appear for a read that is merely not instant.
  it("says nothing about a read that settles inside the threshold", async () => {
    const read = deferred<string>();
    const wrapped = tracked("Reading this machine's providers", read.promise);

    read.resolve("rows");
    await wrapped;
    vi.advanceTimersByTime(60_000);

    expect(slowRequest()).toBeNull();
  });

  it("names the read once it passes the threshold", async () => {
    const read = deferred<string>();
    void tracked("Reading this machine's providers", read.promise);

    vi.advanceTimersByTime(3_999);
    expect(slowRequest()).toBeNull();

    vi.advanceTimersByTime(1);
    expect(slowRequest()).toEqual({ label: "Reading this machine's providers" });

    // …and clears itself a beat after the read lands, without a dismiss.
    read.resolve("rows");
    await vi.advanceTimersByTimeAsync(0);
    expect(slowRequest()).not.toBeNull();

    vi.advanceTimersByTime(2_000);
    expect(slowRequest()).toBeNull();
  });

  /// Two slow reads are one wait, so the line names the older one and a second
  /// threshold crossing does not rewrite it under the reader.
  it("keeps naming the oldest read still running", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    void tracked("Reading this machine's providers", first.promise);
    vi.advanceTimersByTime(1_000);
    void tracked("Reading the model list", second.promise);

    vi.advanceTimersByTime(3_000);
    expect(slowRequest()).toEqual({ label: "Reading this machine's providers" });

    // The older one lands and the newer is still going: the line follows it
    // rather than going out while something is still slow.
    first.resolve("rows");
    await vi.advanceTimersByTimeAsync(0);
    expect(slowRequest()).toEqual({ label: "Reading the model list" });

    second.resolve("rows");
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(2_000);
    expect(slowRequest()).toBeNull();
  });

  /// A failed read left an error in the composer's own slot; a line saying a read
  /// is still in progress beside it describes work that is over.
  it("settles the line on a failure as well", async () => {
    const read = deferred<string>();
    const wrapped = tracked("Reading this machine's providers", read.promise);
    vi.advanceTimersByTime(4_000);
    expect(slowRequest()).not.toBeNull();

    read.reject(new Error("nope"));
    await wrapped.catch(() => undefined);
    vi.advanceTimersByTime(2_000);

    expect(slowRequest()).toBeNull();
  });

  it("drops the line on a dismiss, while the read is still running", async () => {
    const read = deferred<string>();
    void tracked("Reading this machine's providers", read.promise);
    vi.advanceTimersByTime(4_000);
    expect(slowRequest()).not.toBeNull();

    dismissSlow();
    expect(slowRequest()).toBeNull();

    // And a dismiss is not undone by the read it was about finishing later.
    read.resolve("rows");
    await vi.advanceTimersByTimeAsync(0);
    expect(slowRequest()).toBeNull();
  });
});
