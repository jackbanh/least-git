import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { warn as logWarn, info as logInfo } from "@tauri-apps/plugin-log";
import { TextInput } from "@mantine/core";
import { useTabStore } from "../store";
import GitOutputDrawer from "./GitOutputDrawer";
import ProgressBar from "./ProgressBar";
import "./BranchSwitcher.css";

interface BranchInfo {
  name: string;
  is_head: boolean;
}

export default function BranchSwitcher({
  tabId,
  listKey,
  onManualRefresh,
}: {
  tabId: string;
  listKey: number;
  /** Called just before an intentional bumpListKey so the caller can pre-arm
   *  any throttle and suppress the redundant watcher event that follows. */
  onManualRefresh?: () => void;
}) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [filter, setFilter] = useState("");
  const [checkoutBranch, setCheckoutBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bumpListKey = useTabStore((s) => s.bumpListKey);
  const selectCommit = useTabStore((s) => s.selectCommit);
  // Generation counter: if a newer fetch starts before an older one resolves,
  // discard the stale response instead of overwriting correct data.
  const fetchGenRef = useRef(0);
  // Stale-while-revalidate: the last successfully loaded branches for this tab.
  // Populated on every successful fetch so it survives across listKey refreshes
  // even when a new refresh fires before the previous one completes.
  const lastKnownBranchesRef = useRef<BranchInfo[]>([]);
  const branchesRef = useRef(branches);
  branchesRef.current = branches;
  // True while a fetch is in-flight and we have no data yet for this tab.
  const initialFetchInFlightRef = useRef(false);

  useEffect(() => {
    // If we're still waiting for the very first load (no branches, no stale),
    // a watcher-triggered refresh can't show anything better — skip it and let
    // the in-flight fetch complete instead of queuing a duplicate.
    if (
      initialFetchInFlightRef.current &&
      lastKnownBranchesRef.current.length === 0
    ) {
      logInfo(`BranchSwitcher[${tabId}] refresh skipped — initial fetch still in flight listKey=${listKey}`);
      return;
    }
    const gen = ++fetchGenRef.current;
    setIsRefreshing(true);
    setFilter("");
    initialFetchInFlightRef.current = lastKnownBranchesRef.current.length === 0;
    const t0 = performance.now();
    logInfo(`BranchSwitcher[${tabId}] refresh start listKey=${listKey} lastKnown=${lastKnownBranchesRef.current.length}`);
    invoke<BranchInfo[]>("list_branches", { tabId })
      .then((data) => {
        if (gen !== fetchGenRef.current) return;
        const ms = Math.round(performance.now() - t0);
        logInfo(`BranchSwitcher[${tabId}] refresh done count=${data.length} ms=${ms}`);
        if (data.length === 0) {
          logWarn(`BranchSwitcher[${tabId}] list_branches returned 0 — keeping lastKnown=${lastKnownBranchesRef.current.length}`);
          // Don't replace non-empty last-known data with an empty result; the
          // repo is almost certainly mid-operation. Let the next refresh fix it.
          if (lastKnownBranchesRef.current.length > 0) return;
        }
        lastKnownBranchesRef.current = data;
        setBranches(data);
      })
      .catch((e) => {
        if (gen !== fetchGenRef.current) return;
        const ms = Math.round(performance.now() - t0);
        logWarn(`BranchSwitcher[${tabId}] refresh failed ms=${ms} error=${e}`);
      })
      .finally(() => {
        if (gen === fetchGenRef.current) {
          setIsRefreshing(false);
          initialFetchInFlightRef.current = false;
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, listKey]);

  // Show last-known branches while a refresh is in flight so the list never blanks.
  const visibleBranches =
    branches.length === 0 && lastKnownBranchesRef.current.length > 0
      ? lastKnownBranchesRef.current
      : branches;

  const filtered = useMemo(() => {
    if (!filter.trim()) return visibleBranches;
    const q = filter.toLowerCase();
    return visibleBranches.filter((b) => b.name.toLowerCase().includes(q));
  }, [visibleBranches, filter]);

  function handleCheckout(name: string) {
    if (checkoutBranch || visibleBranches.find((b) => b.name === name)?.is_head) return;
    logInfo(`BranchSwitcher[${tabId}] checkout start branch=${name}`);
    setError(null);
    setCheckoutBranch(name);
  }

  function handleCheckoutSuccess() {
    logInfo(`BranchSwitcher[${tabId}] checkout success`);
    onManualRefresh?.(); // pre-arm throttle before bumpListKey triggers watcher
    bumpListKey(tabId);
    selectCommit(tabId, null);
    // Re-fetch branch list to reflect new HEAD (reuses the same generation guard).
    const gen = ++fetchGenRef.current;
    const t0 = performance.now();
    invoke<BranchInfo[]>("list_branches", { tabId }).then((data) => {
      if (gen !== fetchGenRef.current) return;
      const ms = Math.round(performance.now() - t0);
      logInfo(`BranchSwitcher[${tabId}] post-checkout refresh done count=${data.length} ms=${ms}`);
      lastKnownBranchesRef.current = data;
      setBranches(data);
    });
  }

  function handleCheckoutClose() {
    setCheckoutBranch(null);
  }

  return (
    <div className="branch-switcher">
      <ProgressBar visible={isRefreshing} />
      <div className="branch-switcher-header">Branches</div>
      <div className="branch-filter-wrap">
        <TextInput
          size="xs"
          placeholder="Filter branches…"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
      </div>
      {error && <div className="branch-error">{error}</div>}
      <div className="branch-list">
        {filtered.map((branch) => (
          <div
            key={branch.name}
            className={[
              "branch-row",
              branch.is_head ? "branch-row--head" : "",
              checkoutBranch === branch.name ? "branch-row--checking" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => handleCheckout(branch.name)}
          >
            {branch.name}
          </div>
        ))}
        {filtered.length === 0 && filter && (
          <div className="branch-empty">No matches</div>
        )}
      </div>
      <GitOutputDrawer
        tabId={tabId}
        opened={!!checkoutBranch}
        title={`Checkout ${checkoutBranch ?? ""}`}
        command="checkout_branch"
        commandArgs={{ branch: checkoutBranch ?? "" }}
        eventPrefix="checkout"
        onClose={handleCheckoutClose}
        onSuccess={handleCheckoutSuccess}
      />
    </div>
  );
}
