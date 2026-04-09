import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Menu } from "@mantine/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { warn as logWarn } from "@tauri-apps/plugin-log";
import {
  IconCopy,
  IconGitPullRequest,
  IconRefresh,
  IconRotate2,
} from "@tabler/icons-react";
import { useTabStore } from "../store";
import { UNCOMMITTED } from "./CommitDetail";
import ProgressBar from "./ProgressBar";
import PullDrawer from "./PullDrawer";
import "./CommitList.css";

interface ContextMenuState {
  oid: string;
  x: number;
  y: number;
}

interface CommitInfo {
  oid: string;
  short_oid: string;
  summary: string;
  author_name: string;
  author_email: string;
  timestamp: number;
}

const PAGE_SIZE = 25;

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function CommitList({ tabId, listKey }: { tabId: string; listKey: number }) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuOidRef = useRef<string | null>(null);
  const [pullDrawerOpen, setPullDrawerOpen] = useState(false);
  const bumpListKey = useTabStore((s) => s.bumpListKey);
  const parentRef = useRef<HTMLDivElement>(null);
  // Ref-based guard so concurrent effect firings see the updated value synchronously,
  // preventing duplicate fetches when loadMore is recreated after each page lands.
  const isLoadingRef = useRef(false);
  // Stale-while-revalidate: preserve previous commits for display until fresh page 0 arrives.
  const staleCommitsRef = useRef<CommitInfo[]>([]);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const prevListKeyRef = useRef(listKey);

  const selectedOid = useTabStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.selectedOid ?? null
  );
  const selectCommit = useTabStore((s) => s.selectCommit);

  const loadMore = useCallback(async () => {
    if (isLoadingRef.current || !hasMore) return;
    isLoadingRef.current = true;
    try {
      const next = await invoke<CommitInfo[]>("load_commits", {
        tabId,
        offset: commits.length,
        limit: PAGE_SIZE,
      });
      setCommits((prev) => [...prev, ...next]);
      if (next.length === 0 && commits.length === 0) logWarn(`load_commits returned 0 commits for tab ${tabId}`);
      if (next.length < PAGE_SIZE) setHasMore(false);
    } catch (e) {
      console.error("load_commits failed:", e);
      setHasMore(false);
    } finally {
      isLoadingRef.current = false;
    }
  }, [tabId, commits.length, hasMore]);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When listKey changes (refresh signal), keep showing current commits until fresh
  // page 0 arrives, then replace them.
  useEffect(() => {
    if (listKey === prevListKeyRef.current) return;
    prevListKeyRef.current = listKey;

    // Only overwrite stale if there's actually something to preserve.
    // On a rapid double-bump, commitsRef is already [] (cleared by the first bump),
    // so we must not overwrite the stale data we already saved.
    if (commitsRef.current.length > 0) {
      staleCommitsRef.current = commitsRef.current;
    }
    setCommits([]);
    setHasMore(true);
    isLoadingRef.current = true;

    invoke<CommitInfo[]>("load_commits", { tabId, offset: 0, limit: PAGE_SIZE })
      .then((fresh) => {
        staleCommitsRef.current = [];
        setCommits(fresh);
        if (fresh.length === 0) logWarn(`load_commits returned 0 commits for tab ${tabId}`);
        if (fresh.length < PAGE_SIZE) setHasMore(false);
      })
      .catch(() => {
        // Do NOT clear staleCommitsRef here — keep stale data visible on error.
        setHasMore(false);
      })
      .finally(() => {
        isLoadingRef.current = false;
      });
  // tabId is stable for the component lifetime (key={activeTabId} remounts on tab change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  // Show stale commits while fresh page 0 is in flight, then switch to fresh commits.
  const visibleCommits =
    commits.length === 0 && staleCommitsRef.current.length > 0
      ? staleCommitsRef.current
      : commits;

  // index 0 = uncommitted row, 1..N = visibleCommits[index-1], +1 more if hasMore
  const count = 1 + visibleCommits.length + (hasMore ? 1 : 0);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 15,
  });

  const items = virtualizer.getVirtualItems();

  // current flat index: 0 = uncommitted, 1..N = visibleCommits[index-1]
  const selectedIndex =
    selectedOid === UNCOMMITTED
      ? 0
      : visibleCommits.findIndex((c) => c.oid === selectedOid) + 1;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const maxIndex = visibleCommits.length; // 0..visibleCommits.length (last = last commit)
    const next =
      e.key === "ArrowUp"
        ? Math.max(0, selectedIndex - 1)
        : Math.min(maxIndex, selectedIndex + 1);
    if (next === selectedIndex) return;
    const oid = next === 0 ? UNCOMMITTED : visibleCommits[next - 1]?.oid;
    if (oid) {
      selectCommit(tabId, oid);
      virtualizer.scrollToIndex(next, { behavior: "auto" });
    }
  }

  useEffect(() => {
    const last = items[items.length - 1];
    if (!last) return;
    // subtract 1 for the uncommitted row when checking proximity to end
    if (last.index - 1 >= commits.length - 20 && hasMore && !isLoadingRef.current) {
      loadMore();
    }
  }, [items, commits.length, hasMore, loadMore]);

  return (
    <div
      ref={parentRef}
      className="commit-list"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={contextMenu ? { overflowY: "hidden" } : undefined}
    >
      <ProgressBar visible={commits.length === 0 && hasMore} />
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vItem) => {
          if (vItem.index === 0) {
            return (
              <div
                key={vItem.key}
                className={`commit-row${selectedOid === UNCOMMITTED ? " commit-row--selected" : ""}`}
                style={{
                  position: "absolute",
                  top: vItem.start,
                  left: 0,
                  right: 0,
                  height: vItem.size,
                }}
                onClick={() => selectCommit(tabId, UNCOMMITTED)}
              >
                <span className="commit-oid">●</span>
                <span className="commit-summary">Uncommitted changes</span>
              </div>
            );
          }

          const commit = visibleCommits[vItem.index - 1];
          const isSelected = commit?.oid === selectedOid;
          return (
            <div
              key={vItem.key}
              className={`commit-row${isSelected ? " commit-row--selected" : ""}`}
              style={{
                position: "absolute",
                top: vItem.start,
                left: 0,
                right: 0,
                height: vItem.size,
              }}
              onClick={() => commit && selectCommit(tabId, commit.oid)}
              onContextMenu={(e) => {
                if (!commit) return;
                e.preventDefault();
                selectCommit(tabId, commit.oid);
                contextMenuOidRef.current = commit.oid;
                setContextMenu({ oid: commit.oid, x: e.clientX, y: e.clientY });
              }}
            >
              {commit ? (
                <>
                  <span className="commit-oid">{commit.short_oid}</span>
                  <span className="commit-summary">{commit.summary}</span>
                  <span className="commit-author">{commit.author_name}</span>
                  <span className="commit-date">{formatDate(commit.timestamp)}</span>
                </>
              ) : (
                <span className="commit-loading">Loading…</span>
              )}
            </div>
          );
        })}
      </div>
      <Menu
        opened={!!contextMenu}
        onClose={() => setContextMenu(null)}
        position="right-start"
      >
        <Menu.Target>
          {/* Zero-size anchor positioned at the right-click coordinates */}
          <div
            style={{
              position: "fixed",
              left: contextMenu?.x ?? 0,
              top: contextMenu?.y ?? 0,
              width: 0,
              height: 0,
            }}
          />
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => contextMenuOidRef.current && writeText(contextMenuOidRef.current)}>
            Copy SHA-1
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<IconGitPullRequest size={14} />} onClick={() => setPullDrawerOpen(true)}>Pull with Rebase</Menu.Item>
          <Menu.Item leftSection={<IconRefresh size={14} />}>Rebase Interactively onto Here</Menu.Item>
          <Menu.Item leftSection={<IconRotate2 size={14} />} color="red">Reset to Here…</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <PullDrawer
        tabId={tabId}
        opened={pullDrawerOpen}
        onClose={() => setPullDrawerOpen(false)}
        onSuccess={() => bumpListKey(tabId)}
      />
    </div>
  );
}
