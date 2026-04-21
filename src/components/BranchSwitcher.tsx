import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { warn as logWarn, info as logInfo } from "@tauri-apps/plugin-log";
import { useTabStore } from "../store";
import GitOutputDrawer from "./GitOutputDrawer";
import ProgressBar from "./ProgressBar";
import "./BranchSwitcher.css";

interface BranchInfo {
  name: string;
  is_head: boolean;
}

function SearchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export default function BranchSwitcher({
  tabId,
  listKey,
  onManualRefresh,
}: {
  tabId: string;
  listKey: number;
  onManualRefresh?: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [filterFocused, setFilterFocused] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [checkoutBranch, setCheckoutBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bumpListKey = useTabStore((s) => s.bumpListKey);
  const selectCommit = useTabStore((s) => s.selectCommit);
  const queryClient = useQueryClient();

  // Invalidate the stable query key whenever listKey bumps.
  // This triggers a background refetch while the previous data stays visible.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["branches", tabId] });
  }, [tabId, listKey, queryClient]);

  // Stable query key (no listKey) so the cache persists across remounts.
  // On a tab switch the component unmounts/remounts, but the QueryClient lives
  // outside React — cached data survives and is shown immediately while the
  // background refetch triggered by the invalidation above runs.
  const { data: branches = [], isFetching } = useQuery<BranchInfo[]>({
    queryKey: ["branches", tabId],
    queryFn: async ({ signal }) => {
      const t0 = performance.now();
      logInfo(`BranchSwitcher[${tabId}] refresh start listKey=${listKey}`);
      try {
        const data = await invoke<BranchInfo[]>("list_branches", { tabId });
        if (signal.aborted) return Promise.reject(new Error("aborted"));
        const ms = Math.round(performance.now() - t0);
        if (data.length === 0) {
          logWarn(`BranchSwitcher[${tabId}] list_branches returned 0 — keeping previous`);
          // Return the existing cached data so the list doesn't flash empty.
          const cached = queryClient.getQueryData<BranchInfo[]>(["branches", tabId]);
          if (cached && cached.length > 0) return cached;
        }
        logInfo(`BranchSwitcher[${tabId}] refresh done count=${data.length} ms=${ms}`);
        // Auto-select the HEAD branch whenever the list refreshes
        const head = data.find((b) => b.is_head);
        if (head) setSelectedName(head.name);
        return data;
      } catch (e) {
        const ms = Math.round(performance.now() - t0);
        logWarn(`BranchSwitcher[${tabId}] refresh failed ms=${ms} error=${e}`);
        throw e;
      }
    },
    // Keep previous data visible while revalidating (stale-while-revalidate)
    placeholderData: (prev) => prev,
    // Don't refetch on window focus — we drive updates via listKey / invalidation
    refetchOnWindowFocus: false,
  });

  const filtered = useMemo(() => {
    if (!filter.trim()) return branches;
    const q = filter.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, filter]);

  function handleCheckout(name: string) {
    if (checkoutBranch || branches.find((b) => b.name === name)?.is_head) return;
    logInfo(`BranchSwitcher[${tabId}] checkout start branch=${name}`);
    setError(null);
    setCheckoutBranch(name);
  }

  function handleCheckoutSuccess() {
    logInfo(`BranchSwitcher[${tabId}] checkout success`);
    onManualRefresh?.();
    bumpListKey(tabId);
    selectCommit(tabId, null);
  }

  function handleCheckoutClose() {
    setCheckoutBranch(null);
  }

  // Linen-like noise texture — fine fractalNoise at low opacity
  const linenBg = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;

  return (
    <div className="branch-switcher">
      {/* Linen texture overlay */}
      <div
        className="branch-linen"
        style={{ backgroundImage: linenBg }}
      />

      <ProgressBar visible={isFetching} />

      <div className="branch-content">
        {/* Header */}
        <div className="branch-header">
          <span className="branch-header-label">Branches</span>
          <span className="branch-header-count">{branches.length}</span>
        </div>

        {/* Filter */}
        <div className="branch-filter-wrap">
          <div className={`branch-filter-box${filterFocused ? " branch-filter-box--focused" : ""}`}>
            <span className="branch-filter-icon"><SearchIcon /></span>
            <input
              className="branch-filter-input"
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              onFocus={() => setFilterFocused(true)}
              onBlur={() => setFilterFocused(false)}
              placeholder="Filter branches…"
            />
            {filter && (
              <button className="branch-filter-clear" onClick={() => setFilter("")}>×</button>
            )}
          </div>
        </div>

        {error && <div className="branch-error">{error}</div>}

        {/* Branch list */}
        <div className="branch-list">
          {filtered.map((branch) => (
            <BranchRow
              key={branch.name}
              branch={branch}
              selected={branch.name === selectedName}
              isChecking={checkoutBranch === branch.name}
              onSelect={() => setSelectedName(branch.name)}
              onDoubleClick={() => handleCheckout(branch.name)}
            />
          ))}
          {filtered.length === 0 && filter && (
            <div className="branch-empty">No matching branches.</div>
          )}
        </div>
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

function BranchRow({
  branch,
  selected,
  isChecking,
  onSelect,
  onDoubleClick,
}: {
  branch: BranchInfo;
  selected: boolean;
  isChecking: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      className={[
        "branch-row",
        branch.is_head ? "branch-row--head" : "",
        selected ? "branch-row--selected" : "",
        isChecking ? "branch-row--checking" : "",
      ].filter(Boolean).join(" ")}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {/* Current-branch accent bar */}
      {branch.is_head && (
        <div className="branch-row-accent-bar branch-row-accent-bar--head" />
      )}
      {/* Selection indent bar (non-HEAD) */}
      {selected && !branch.is_head && (
        <div className="branch-row-accent-bar branch-row-accent-bar--selected" />
      )}
      <span className="branch-row-name">{branch.name}</span>
      {branch.is_head && (
        <div className="branch-row-head-dot" />
      )}
    </div>
  );
}
