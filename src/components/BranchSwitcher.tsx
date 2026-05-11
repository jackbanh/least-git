import { useEffect, useMemo, useRef, useState } from "react";
import { useContextMenu } from "../hooks/useContextMenu";
import { AnchoredMenuTarget } from "./FileRow";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { warn as logWarn, info as logInfo } from "@tauri-apps/plugin-log";
import { Menu, Popover } from "@mantine/core";
import { IconGitBranch, IconCopy, IconChevronDown } from "@tabler/icons-react";
import { useTabStore } from "../store";
import GitOutputDrawer from "./GitOutputDrawer";
import ProgressBar from "./ProgressBar";
import "./BranchSwitcher.css";

interface BranchInfo {
  name: string;
  is_head: boolean;
}

// ---------------------------------------------------------------------------
// Module-level cache — survives tab switches (component unmount/remount).
// ---------------------------------------------------------------------------
const branchCache = new Map<string, BranchInfo[]>();

/** Exposed for tests only — resets the module-level cache between test cases. */
export function __resetBranchCache() { branchCache.clear(); }

export default function BranchSwitcher({
  tabId,
  listKey,
  onManualRefresh,
}: {
  tabId: string;
  listKey: number;
  onManualRefresh?: () => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [checkoutBranch, setCheckoutBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { contextMenu, contextTargetRef, open: openContextMenu, close: closeContextMenu } = useContextMenu<BranchInfo>();

  const bumpListKey = useTabStore((s) => s.bumpListKey);
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["branches", tabId] });
  }, [tabId, listKey, queryClient]);

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
          const cached = queryClient.getQueryData<BranchInfo[]>(["branches", tabId]);
          if (cached && cached.length > 0) return cached;
        }
        logInfo(`BranchSwitcher[${tabId}] refresh done count=${data.length} ms=${ms}`);
        if (data.length > 0) branchCache.set(tabId, data);
        const head = data.find((b) => b.is_head);
        if (head) setSelectedName(head.name);
        return data;
      } catch (e) {
        const ms = Math.round(performance.now() - t0);
        logWarn(`BranchSwitcher[${tabId}] refresh failed ms=${ms} error=${e}`);
        throw e;
      }
    },
    initialData: () => branchCache.get(tabId),
    initialDataUpdatedAt: 0,
    refetchOnWindowFocus: false,
  });

  const prevBranchCountRef = useRef(0);
  useEffect(() => {
    const curr = branches.length;
    if (curr === 0 && prevBranchCountRef.current > 0) {
      const cached = queryClient.getQueryData<BranchInfo[]>(["branches", tabId]);
      logWarn(
        `BranchSwitcher[${tabId}] WENT BLANK — isFetching=${isFetching} listKey=${listKey} cachedCount=${cached?.length ?? 0}`
      );
    }
    prevBranchCountRef.current = curr;
  });

  function handleCheckout(name: string) {
    if (checkoutBranch || branches.find((b) => b.name === name)?.is_head) return;
    logInfo(`BranchSwitcher[${tabId}] checkout start branch=${name}`);
    setError(null);
    setCheckoutBranch(name);
    setDropdownOpen(false);
  }

  function handleCheckoutSuccess() {
    logInfo(`BranchSwitcher[${tabId}] checkout success`);
    onManualRefresh?.();
    bumpListKey(tabId);
  }

  function handleCheckoutClose() {
    setCheckoutBranch(null);
  }

  const headBranch = useMemo(() => branches.find((b) => b.is_head), [branches]);
  const displayName = headBranch?.name ?? selectedName ?? "—";

  return (
    <div className="branch-switcher">
      <ProgressBar visible={isFetching} />

      {error && <div className="branch-error">{error}</div>}

      <div className="branch-switcher-inner">
        <span className="branch-switcher-label">Branch</span>
        <Popover
          opened={dropdownOpen}
          onClose={() => setDropdownOpen(false)}
          position="bottom-start"
          width="target"
          shadow="md"
        >
          <Popover.Target>
            <button
              className="branch-dropdown-btn"
              onClick={() => setDropdownOpen((o) => !o)}
            >
              <IconGitBranch size={12} strokeWidth={1.6} className="branch-dropdown-icon" />
              <span className="branch-dropdown-name">{displayName}</span>
              <IconChevronDown size={11} strokeWidth={1.75} className="branch-dropdown-chevron" />
            </button>
          </Popover.Target>

          <Popover.Dropdown className="branch-popover-dropdown">
            <div className="branch-list">
              {branches.map((branch) => (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  selected={branch.name === selectedName}
                  isChecking={checkoutBranch === branch.name}
                  onSelect={() => setSelectedName(branch.name)}
                  onDoubleClick={() => handleCheckout(branch.name)}
                  onContextMenu={(e) => { setSelectedName(branch.name); openContextMenu(e, branch); }}
                />
              ))}
              {branches.length === 0 && (
                <div className="branch-empty">No branches.</div>
              )}
            </div>
          </Popover.Dropdown>
        </Popover>
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

      <Menu
        opened={!!contextMenu}
        onClose={closeContextMenu}
        position="right-start"
      >
        <AnchoredMenuTarget contextMenu={contextMenu} />
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconGitBranch size={14} />}
            onClick={() => handleCheckout(contextTargetRef.current!.data.name)}
            disabled={contextTargetRef.current?.data.is_head}
          >
            Checkout {contextTargetRef.current?.data.name}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={() => navigator.clipboard.writeText(contextTargetRef.current!.data.name)}
          >
            Copy Branch Name
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

function BranchRow({
  branch,
  selected,
  isChecking,
  onSelect,
  onDoubleClick,
  onContextMenu,
}: {
  branch: BranchInfo;
  selected: boolean;
  isChecking: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
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
      onContextMenu={onContextMenu}
    >
      <IconGitBranch
        size={12}
        strokeWidth={1.6}
        className="branch-row-icon"
      />
      <span className="branch-row-name">{branch.name}</span>
      {branch.is_head && (
        <span className="branch-row-current">current</span>
      )}
    </div>
  );
}
