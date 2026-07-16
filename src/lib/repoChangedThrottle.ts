// Coalesces bursty `repo:changed` FS-watcher events into view refreshes, keyed
// per `${tabId}:${kind}`.
//
// Leading-edge dispatch with a trailing-edge follow-up: the first event after a
// quiet window refreshes immediately; further events inside the cooldown are
// *deferred*, not dropped, and collapsed into a single refresh at the cooldown
// boundary. The trailing refresh reads current HEAD, so the view always
// converges — even when an agent commits several times in quick succession.
// The previous leading-edge-only throttle dropped those trailing events and
// left the commit list stale on the first commit of the burst.

export type Dispatch = (tabId: string, kind: string) => void;

export interface RepoChangedThrottle {
  /** Handle an incoming watcher event. Return value is for logging/tests. */
  handle(tabId: string, kind: string): "dispatched" | "deferred" | "coalesced";
  /**
   * Record that the app just refreshed this key itself (an in-app action that
   * already bumped the list). The echoing watcher event then folds into the
   * cooldown instead of triggering a second immediate refresh.
   */
  arm(tabId: string, kind: string): void;
  /** Cancel any pending trailing refreshes. Call on teardown. */
  dispose(): void;
}

export function createRepoChangedThrottle(
  cooldownMs: number,
  dispatch: Dispatch,
): RepoChangedThrottle {
  const lastDispatchAt: Record<string, number> = {};
  const pending: Record<string, ReturnType<typeof setTimeout>> = {};

  function fire(tabId: string, kind: string) {
    lastDispatchAt[`${tabId}:${kind}`] = Date.now();
    dispatch(tabId, kind);
  }

  return {
    handle(tabId, kind) {
      const key = `${tabId}:${kind}`;
      const sinceLastMs = Date.now() - (lastDispatchAt[key] ?? 0);
      if (sinceLastMs < cooldownMs) {
        if (pending[key]) return "coalesced";
        pending[key] = setTimeout(() => {
          delete pending[key];
          fire(tabId, kind);
        }, cooldownMs - sinceLastMs);
        return "deferred";
      }
      fire(tabId, kind);
      return "dispatched";
    },
    arm(tabId, kind) {
      lastDispatchAt[`${tabId}:${kind}`] = Date.now();
    },
    dispose() {
      Object.values(pending).forEach(clearTimeout);
    },
  };
}
