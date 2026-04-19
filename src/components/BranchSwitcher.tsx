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

export default function BranchSwitcher({ tabId, listKey }: { tabId: string; listKey: number }) {
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
  // Stale-while-revalidate: preserve last known branches while a refresh is
  // in flight so the list never goes blank.
  const staleBranchesRef = useRef<BranchInfo[]>([]);
  const branchesRef = useRef(branches);
  branchesRef.current = branches;

  useEffect(() => {
    const gen = ++fetchGenRef.current;
    // Snapshot current branches as stale data before clearing (only if non-empty).
    if (branchesRef.current.length > 0) {
      staleBranchesRef.current = branchesRef.current;
    }
    setIsRefreshing(true);
    setFilter("");
    const t0 = performance.now();
    logInfo(`BranchSwitcher[${tabId}] refresh start listKey=${listKey} stale=${staleBranchesRef.current.length}`);
    invoke<BranchInfo[]>("list_branches", { tabId })
      .then((data) => {
        if (gen !== fetchGenRef.current) return;
        const ms = Math.round(performance.now() - t0);
        logInfo(`BranchSwitcher[${tabId}] refresh done count=${data.length} ms=${ms}`);
        if (data.length === 0) {
          logWarn(`BranchSwitcher[${tabId}] list_branches returned 0 — keeping stale=${staleBranchesRef.current.length}`);
          // Don't replace non-empty stale data with an empty result; the repo
          // is almost certainly mid-operation. Let the next refresh correct it.
          if (staleBranchesRef.current.length > 0) return;
        }
        staleBranchesRef.current = [];
        setBranches(data);
      })
      .catch((e) => {
        if (gen !== fetchGenRef.current) return;
        const ms = Math.round(performance.now() - t0);
        logWarn(`BranchSwitcher[${tabId}] refresh failed ms=${ms} error=${e}`);
      })
      .finally(() => { if (gen === fetchGenRef.current) setIsRefreshing(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, listKey]);

  // Show stale branches while a refresh is in flight so the list never blanks.
  const visibleBranches =
    branches.length === 0 && staleBranchesRef.current.length > 0
      ? staleBranchesRef.current
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
    bumpListKey(tabId);
    selectCommit(tabId, null);
    // Re-fetch branch list to reflect new HEAD (reuses the same generation guard).
    const gen = ++fetchGenRef.current;
    const t0 = performance.now();
    invoke<BranchInfo[]>("list_branches", { tabId }).then((data) => {
      if (gen !== fetchGenRef.current) return;
      const ms = Math.round(performance.now() - t0);
      logInfo(`BranchSwitcher[${tabId}] post-checkout refresh done count=${data.length} ms=${ms}`);
      staleBranchesRef.current = [];
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
