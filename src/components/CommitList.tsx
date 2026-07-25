import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader, Menu } from "@mantine/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { warn as logWarn, info as logInfo, error as logError } from "@tauri-apps/plugin-log";
import {
  IconCopy,
  IconRefresh,
  IconRotate2,
} from "@tabler/icons-react";
import { useTabStore } from "../store";
import { UNCOMMITTED } from "./CommitDetail";
import GitOutputDrawer from "./GitOutputDrawer";
import ResetDialog from "./ResetDialog";
import { useContextMenu } from "../hooks/useContextMenu";
import { AnchoredMenuTarget } from "./FileRow";
import "./CommitList.css";

interface CommitInfo {
  oid: string;
  short_oid: string;
  summary: string;
  author_name: string;
  author_email: string;
  timestamp: number;
  parent_oid: string | null;
}

const PAGE_SIZE = 25;
// Upper bound on the single-call restore after a refresh (4 pages).
const RESTORE_CAP = 100;

// Module-level cache: survives CommitList remounts on tab switch.
// Keyed by tabId. Seeded into staleCommitsRef on mount so the previously
// loaded commits are visible immediately while the fresh fetch runs.
const commitCache = new Map<string, CommitInfo[]>();

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return (words[0][0] ?? "?").toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// Stable per-author hue (0–359). Keyed on email so the same identity always
// maps to the same color regardless of display-name variations.
const authorHueCache = new Map<string, number>();
function getAuthorHue(email: string): number {
  const key = email.trim().toLowerCase();
  const cached = authorHueCache.get(key);
  if (cached !== undefined) return cached;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  authorHueCache.set(key, hue);
  return hue;
}

function formatDate(ts: number): string {
  const nowS = Date.now() / 1000;
  const diff = nowS - ts;
  if (diff < 48 * 3600) {
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}


export default function CommitList({ tabId, listKey }: { tabId: string; listKey: number }) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const { contextMenu, contextTargetRef, open: openContextMenu, close: closeContextMenu } = useContextMenu<string>();
  const [rebaseDrawerOpen, setRebaseDrawerOpen] = useState(false);
  const [rebaseOid, setRebaseOid] = useState<string | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetOid, setResetOid] = useState<string | null>(null);
  const bumpListKey = useTabStore((s) => s.bumpListKey);
  const parentRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);
  const loadGenRef = useRef(0);
  // Seed from module-level cache so tab-switch remounts show previous commits
  // immediately rather than blanking for the ~300ms initial fetch.
  const staleCommitsRef = useRef<CommitInfo[]>(commitCache.get(tabId) ?? []);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;

  // Keep the module-level cache current so the next mount has fresh stale data.
  useEffect(() => {
    if (commits.length > 0) {
      commitCache.set(tabId, commits);
    }
  }, [commits, tabId]);

  const prevListKeyRef = useRef(listKey);
  const lastOidRef = useRef<string | null>(null);
  lastOidRef.current = commits.length > 0
    ? (commits[commits.length - 1].parent_oid ?? null)
    : null;

  const selectedOid = useTabStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.selectedOid ?? null
  );
  const selectCommit = useTabStore((s) => s.selectCommit);
  // Ref so async refresh callbacks can read the current selectedOid without
  // capturing a stale closure value.
  const selectedOidRef = useRef(selectedOid);
  selectedOidRef.current = selectedOid;

  const loadMore = useCallback(async () => {
    if (isLoadingRef.current || !hasMore) return;
    isLoadingRef.current = true;
    const gen = loadGenRef.current;
    const cursor = lastOidRef.current;
    const loadedBefore = commitsRef.current.length;
    logInfo(`CommitList[${tabId}] loadMore start cursor=${cursor?.slice(0, 7) ?? "null"} loaded=${loadedBefore}`);
    const t0 = performance.now();
    try {
      const next = await invoke<CommitInfo[]>("load_commits", {
        tabId,
        afterOid: cursor,
        limit: PAGE_SIZE,
      });
      const ms = Math.round(performance.now() - t0);
      if (gen !== loadGenRef.current) {
        logInfo(`CommitList[${tabId}] loadMore stale (gen ${gen}→${loadGenRef.current}), discarding ${next.length} commits`);
        return;
      }
      logInfo(`CommitList[${tabId}] loadMore done count=${next.length} ms=${ms} hasMore=${next.length >= PAGE_SIZE}`);
      setCommits((prev) => [...prev, ...next]);
      if (next.length === 0 && cursor === null) {
        logWarn(`CommitList[${tabId}] loadMore returned 0 commits from HEAD`);
      }
      if (next.length < PAGE_SIZE || next[next.length - 1]?.parent_oid === null) setHasMore(false);
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      logError(`CommitList[${tabId}] loadMore failed ms=${ms} error=${e}`);
      if (gen === loadGenRef.current) setHasMore(false);
    } finally {
      isLoadingRef.current = false;
    }
  }, [tabId, hasMore]);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (listKey === prevListKeyRef.current) return;
    prevListKeyRef.current = listKey;

    loadGenRef.current += 1;

    const currentCount = commitsRef.current.length;
    const savingStale = currentCount > 0;
    if (savingStale) {
      staleCommitsRef.current = commitsRef.current;
    }
    // Refetch what was on screen in one call. The stale list stays visible during
    // the refresh, so the virtualiser immediately fires loadMore() until the new
    // list matches its length — previously 3 round trips (25 + 25 + 25) and 3
    // repo opens to get back to 75. Capped so a deeply scrolled list doesn't turn
    // one refresh into a huge walk; beyond the cap the old paging path takes over.
    const restoreLimit = Math.min(
      Math.max(currentCount, staleCommitsRef.current.length, PAGE_SIZE),
      RESTORE_CAP,
    );
    logInfo(`CommitList[${tabId}] refresh listKey=${listKey} current=${currentCount} savingStale=${savingStale} staleNow=${staleCommitsRef.current.length} limit=${restoreLimit}`);
    lastOidRef.current = null;
    setCommits([]);
    setHasMore(true);
    isLoadingRef.current = true;

    const t0 = performance.now();
    invoke<CommitInfo[]>("load_commits", { tabId, afterOid: null, limit: restoreLimit })
      .then((fresh) => {
        const ms = Math.round(performance.now() - t0);
        logInfo(`CommitList[${tabId}] refresh done count=${fresh.length} ms=${ms} clearingStale=${staleCommitsRef.current.length}`);
        if (fresh.length === 0) {
          logWarn(`CommitList[${tabId}] refresh returned 0 commits — list will go empty (stale=${staleCommitsRef.current.length})`);
        }
        staleCommitsRef.current = [];
        setCommits(fresh);
        if (fresh.length < restoreLimit || fresh[fresh.length - 1]?.parent_oid === null) setHasMore(false);
        // Re-validate selection: if the previously selected OID is no longer in
        // the fresh list, clear it. UNCOMMITTED is always kept — the working tree
        // is valid regardless of which commits are visible.
        const oid = selectedOidRef.current;
        if (oid && oid !== UNCOMMITTED && !fresh.some((c) => c.oid === oid)) {
          selectCommit(tabId, null);
        }
      })
      .catch((e) => {
        const ms = Math.round(performance.now() - t0);
        logWarn(`CommitList[${tabId}] refresh failed ms=${ms} stale=${staleCommitsRef.current.length} error=${e}`);
        setHasMore(false);
      })
      .finally(() => {
        isLoadingRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  const visibleCommits =
    commits.length === 0 && staleCommitsRef.current.length > 0
      ? staleCommitsRef.current
      : commits;

  // Detect and log every time the list transitions from visible → blank.
  // This fires after every render so we capture the exact state snapshot
  // (commits, stale, hasMore, gen) at the moment the blank occurs.
  const prevVisibleCountRef = useRef(0);
  useEffect(() => {
    const curr = visibleCommits.length;
    if (curr === 0 && prevVisibleCountRef.current > 0) {
      logWarn(
        `CommitList[${tabId}] WENT BLANK — commits=${commits.length} stale=${staleCommitsRef.current.length} hasMore=${hasMore} gen=${loadGenRef.current} isLoading=${isLoadingRef.current}`
      );
    }
    prevVisibleCountRef.current = curr;
  });

  // index 0 = uncommitted row, 1..N = visibleCommits[index-1], +1 more if hasMore
  const count = 1 + visibleCommits.length + (hasMore ? 1 : 0);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
    overscan: 15,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const items = virtualizer.getVirtualItems();

  const selectedIndex =
    selectedOid === UNCOMMITTED
      ? 0
      : visibleCommits.findIndex((c) => c.oid === selectedOid) + 1;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const maxIndex = visibleCommits.length;
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
    if (last.index - 1 >= commits.length - 20 && hasMore && !isLoadingRef.current) {
      loadMore();
    }
  }, [items, commits.length, hasMore, loadMore]);

  return (
    <div className="commit-list-wrap">
      <div className="commit-list-header">
        <span className="commit-list-header-label">History</span>
        {commits.length === 0 && hasMore && (
          <Loader size={11} color="var(--lg-ink-faint)" role="progressbar" />
        )}
      </div>

      <div
        ref={parentRef}
        className="commit-list"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={contextMenu ? { overflowY: "hidden" } : undefined}
      >
        {/* Continuous dot rail */}
        <div className="commit-dot-rail" />

        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((vItem) => {
            if (vItem.index === 0) {
              const isSelected = selectedOid === UNCOMMITTED;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  className={`commit-row${isSelected ? " commit-row--selected" : ""}`}
                  style={{ position: "absolute", top: vItem.start, left: 0, right: 0 }}
                  onClick={() => selectCommit(tabId, UNCOMMITTED)}
                >
                  <div className="commit-row-dot">
                    <div className="commit-dot commit-dot--uncommitted" />
                  </div>
                  <div className="commit-row-body">
                    <div className={`commit-uncommitted-title${isSelected ? " commit-uncommitted-title--selected" : ""}`}>
                      Uncommitted changes
                    </div>
                    <div className="commit-uncommitted-sub">working tree</div>
                  </div>
                </div>
              );
            }

            const commit = visibleCommits[vItem.index - 1];
            const isSelected = commit?.oid === selectedOid;
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                className={`commit-row${isSelected ? " commit-row--selected" : ""}`}
                style={{ position: "absolute", top: vItem.start, left: 0, right: 0 }}
                onClick={() => commit && selectCommit(tabId, commit.oid)}
                onContextMenu={(e) => {
                  if (!commit) return;
                  selectCommit(tabId, commit.oid);
                  openContextMenu(e, commit.oid);
                }}
              >
                {commit ? (
                  <>
                    <div className="commit-row-dot">
                      <div className={`commit-dot${isSelected ? " commit-dot--selected" : ""}`} />
                    </div>
                    <div className="commit-row-body">
                      <div className={`commit-title${isSelected ? " commit-title--selected" : ""}`}>
                        {commit.summary}
                      </div>
                      <div className="commit-author-cell">
                        <div className="commit-author-identity">
                          <div
                            className="commit-initials-avatar"
                            style={{ "--author-hue": getAuthorHue(commit.author_email) } as React.CSSProperties}
                          >
                            {getInitials(commit.author_name)}
                          </div>
                          <span className="commit-author-text">{commit.author_name}</span>
                        </div>
                        <span className="commit-date">{formatDate(commit.timestamp)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="commit-loading">Loading…</div>
                )}
              </div>
            );
          })}
        </div>
        <Menu
          opened={!!contextMenu}
          onClose={closeContextMenu}
          position="right-start"
        >
          <AnchoredMenuTarget contextMenu={contextMenu} />
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => contextTargetRef.current && writeText(contextTargetRef.current.data)}>
              Copy SHA-1
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              leftSection={<IconRefresh size={14} />}
              onClick={() => {
                if (contextTargetRef.current) {
                  setRebaseOid(contextTargetRef.current.data);
                  setRebaseDrawerOpen(true);
                }
              }}
            >
              Rebase Interactively onto Here
            </Menu.Item>
            <Menu.Item
              leftSection={<IconRotate2 size={14} />}
              color="red"
              onClick={() => {
                if (contextTargetRef.current) {
                  setResetOid(contextTargetRef.current.data);
                  setResetDialogOpen(true);
                }
              }}
            >
              Reset to Here…
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <GitOutputDrawer
          tabId={tabId}
          opened={rebaseDrawerOpen}
          title="Rebase Interactively"
          command="rebase_interactive"
          commandArgs={{ oid: rebaseOid ?? "" }}
          eventPrefix="rebase"
          displayCommand={`git rebase -i ${rebaseOid ?? ""}`}
          onClose={() => setRebaseDrawerOpen(false)}
          onSuccess={() => bumpListKey(tabId)}
        />
        <ResetDialog
          tabId={tabId}
          opened={resetDialogOpen}
          oid={resetOid}
          summary={commits.find((c) => c.oid === resetOid)?.summary}
          onClose={() => setResetDialogOpen(false)}
          // Reset moves HEAD and rewrites the index/working tree; listKey drives
          // a full refresh of both the history and the working-tree status.
          onReset={() => bumpListKey(tabId)}
        />
      </div>
    </div>
  );
}
