import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

  useEffect(() => {
    const gen = ++fetchGenRef.current;
    setIsRefreshing(true);
    setFilter("");
    invoke<BranchInfo[]>("list_branches", { tabId })
      .then((data) => { if (gen === fetchGenRef.current) setBranches(data); })
      .finally(() => { if (gen === fetchGenRef.current) setIsRefreshing(false); });
  }, [tabId, listKey]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return branches;
    const q = filter.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, filter]);

  function handleCheckout(name: string) {
    if (checkoutBranch || branches.find((b) => b.name === name)?.is_head) return;
    setError(null);
    setCheckoutBranch(name);
  }

  function handleCheckoutSuccess() {
    bumpListKey(tabId);
    selectCommit(tabId, null);
    // Re-fetch branch list to reflect new HEAD (reuses the same generation guard).
    const gen = ++fetchGenRef.current;
    invoke<BranchInfo[]>("list_branches", { tabId }).then((data) => {
      if (gen === fetchGenRef.current) setBranches(data);
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
