import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TextInput } from "@mantine/core";
import { useTabStore } from "../store";
import "./BranchSwitcher.css";

interface BranchInfo {
  name: string;
  is_head: boolean;
}

export default function BranchSwitcher({ tabId }: { tabId: string }) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bumpListKey = useTabStore((s) => s.bumpListKey);
  const selectCommit = useTabStore((s) => s.selectCommit);

  useEffect(() => {
    invoke<BranchInfo[]>("list_branches", { tabId }).then(setBranches);
    setFilter("");
  }, [tabId]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return branches;
    const q = filter.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, filter]);

  async function handleCheckout(name: string) {
    if (checking || branches.find((b) => b.name === name)?.is_head) return;
    setChecking(name);
    setError(null);
    try {
      await invoke("checkout_branch", { tabId, branch: name });
      bumpListKey(tabId);
      selectCommit(tabId, null);
      const updated = await invoke<BranchInfo[]>("list_branches", { tabId });
      setBranches(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="branch-switcher">
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
              checking === branch.name ? "branch-row--checking" : "",
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
    </div>
  );
}
