import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRepoChangedThrottle } from "../lib/repoChangedThrottle";

describe("createRepoChangedThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dispatches the first event in a quiet window immediately", () => {
    const dispatch = vi.fn();
    const t = createRepoChangedThrottle(2000, dispatch);
    expect(t.handle("tab", "refs")).toBe("dispatched");
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("tab", "refs");
  });

  it("defers a burst into a single trailing refresh (the stale-list bug)", () => {
    const dispatch = vi.fn();
    const t = createRepoChangedThrottle(2000, dispatch);

    // Agent commits three times in quick succession.
    expect(t.handle("tab", "refs")).toBe("dispatched"); // commit 1, immediate
    vi.advanceTimersByTime(500);
    expect(t.handle("tab", "refs")).toBe("deferred"); // commit 2, within cooldown
    vi.advanceTimersByTime(300);
    expect(t.handle("tab", "refs")).toBe("coalesced"); // commit 3, folded in

    // Only the first refresh has fired so far.
    expect(dispatch).toHaveBeenCalledTimes(1);

    // Crossing the cooldown boundary fires exactly one trailing refresh, which
    // reads current HEAD and surfaces commits 2 and 3.
    vi.advanceTimersByTime(2000);
    expect(dispatch).toHaveBeenCalledTimes(2);

    // Nothing further fires once the burst is drained.
    vi.advanceTimersByTime(5000);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("throttles refs and index independently", () => {
    const dispatch = vi.fn();
    const t = createRepoChangedThrottle(2000, dispatch);
    expect(t.handle("tab", "refs")).toBe("dispatched");
    expect(t.handle("tab", "index")).toBe("dispatched");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("does not cross-throttle different tabs", () => {
    const dispatch = vi.fn();
    const t = createRepoChangedThrottle(2000, dispatch);
    expect(t.handle("tabA", "refs")).toBe("dispatched");
    expect(t.handle("tabB", "refs")).toBe("dispatched");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("arm() folds the in-app echo into the cooldown instead of double-refreshing", () => {
    const dispatch = vi.fn();
    const t = createRepoChangedThrottle(2000, dispatch);

    // App performed an in-app action and refreshed itself, then armed.
    t.arm("tab", "refs");
    vi.advanceTimersByTime(500);
    // The watcher echo of that same write must not trigger a second immediate
    // refresh; it is deferred and coalesced.
    expect(t.handle("tab", "refs")).toBe("deferred");
    expect(dispatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispose() cancels a pending trailing refresh", () => {
    const dispatch = vi.fn();
    const t = createRepoChangedThrottle(2000, dispatch);
    t.handle("tab", "refs"); // dispatch
    vi.advanceTimersByTime(200);
    t.handle("tab", "refs"); // deferred
    t.dispose();
    vi.advanceTimersByTime(5000);
    expect(dispatch).toHaveBeenCalledTimes(1); // trailing never fired
  });
});
