import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTabStore } from "../store";
import { UNCOMMITTED } from "./CommitDetail";
import ProgressBar from "./ProgressBar";
import "./CommitList.css";

interface CommitInfo {
  oid: string;
  short_oid: string;
  summary: string;
  author_name: string;
  author_email: string;
  timestamp: number;
}

const PAGE_SIZE = 100;

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function CommitList({ tabId }: { tabId: string }) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const parentRef = useRef<HTMLDivElement>(null);
  // Ref-based guard so concurrent effect firings see the updated value synchronously,
  // preventing duplicate fetches when loadMore is recreated after each page lands.
  const isLoadingRef = useRef(false);

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

  // index 0 = uncommitted row, 1..N = commits[index-1], +1 more if hasMore
  const count = 1 + commits.length + (hasMore ? 1 : 0);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 15,
  });

  const items = virtualizer.getVirtualItems();

  // current flat index: 0 = uncommitted, 1..N = commits[index-1]
  const selectedIndex =
    selectedOid === UNCOMMITTED
      ? 0
      : commits.findIndex((c) => c.oid === selectedOid) + 1;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const maxIndex = commits.length; // 0..commits.length (last = last commit)
    const next =
      e.key === "ArrowUp"
        ? Math.max(0, selectedIndex - 1)
        : Math.min(maxIndex, selectedIndex + 1);
    if (next === selectedIndex) return;
    const oid = next === 0 ? UNCOMMITTED : commits[next - 1]?.oid;
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
    <div ref={parentRef} className="commit-list" tabIndex={0} onKeyDown={handleKeyDown}>
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

          const commit = commits[vItem.index - 1];
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
    </div>
  );
}
