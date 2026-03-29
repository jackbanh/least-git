import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTabStore } from "../store";
import { UNCOMMITTED } from "./CommitDetail";
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

export default function CommitList({ tabId }: { tabId: string }) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const parentRef = useRef<HTMLDivElement>(null);

  const selectedOid = useTabStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.selectedOid ?? null
  );
  const selectCommit = useTabStore((s) => s.selectCommit);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
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
      setIsLoading(false);
    }
  }, [tabId, commits.length, isLoading, hasMore]);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = hasMore ? commits.length + 1 : commits.length;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 15,
  });

  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = items[items.length - 1];
    if (!last) return;
    if (last.index >= commits.length - 20 && hasMore && !isLoading) {
      loadMore();
    }
  }, [items, commits.length, hasMore, isLoading, loadMore]);

  return (
    <>
      <div
        className={`commit-row${selectedOid === UNCOMMITTED ? " commit-row--selected" : ""}`}
        onClick={() => selectCommit(tabId, UNCOMMITTED)}
      >
        <span className="commit-oid">●</span>
        <span className="commit-summary">Uncommitted changes</span>
      </div>
      <div ref={parentRef} className="commit-list">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vItem) => {
          const commit = commits[vItem.index];
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
                </>
              ) : (
                <span className="commit-loading">Loading…</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
