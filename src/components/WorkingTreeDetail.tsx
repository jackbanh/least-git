import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { warn as logWarn, info as logInfo } from "@tauri-apps/plugin-log";
import { Loader, Menu } from "@mantine/core";
import {
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconCopy,
  IconGitCompare,
  IconGitMerge,
  IconRotate2,
  IconTrash,
} from "@tabler/icons-react";
import { useTabStore } from "../store";
import { useResize } from "../hooks/useResize";
import { useContextMenu } from "../hooks/useContextMenu";
import { AnchoredMenuTarget } from "./FileRow";
import { FileTree } from "./FileTree";
import InteractiveDiffViewer from "./InteractiveDiffViewer";
import "./CommitDetail.css";
import "./WorkingTreeDetail.css";

interface StatusEntry {
  path: string;
  old_path: string | null;
  status: string;
  is_conflict: boolean;
}

interface WorkingTreeStatus {
  staged: StatusEntry[];
  unstaged: StatusEntry[];
  head_branch: string;
}

interface SelectedFile {
  path: string;
  staged: boolean;
  is_untracked: boolean;
}

interface ContextData { entry: StatusEntry; staged: boolean }

export default function WorkingTreeDetail({ tabId, listKey, statusKey }: { tabId: string; listKey: number; statusKey: number }) {
  const [status, setStatus] = useState<WorkingTreeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  // Untracked files arrive separately (~2–3 s later). null = still loading.
  const [untracked, setUntracked] = useState<StatusEntry[] | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);
  const detailLeftWidth = useTabStore((s) => s.detailLeftWidth);
  const setDetailLeftWidth = useTabStore((s) => s.setDetailLeftWidth);
  const startLeftResize = useResize(detailLeftWidth, setDetailLeftWidth, "horizontal", 140, 9999);

  // ── Context menu ────────────────────────────────────────────────────────
  const { contextMenu, contextTargetRef, open: openMenu, close: closeMenu } = useContextMenu<ContextData>();
  // Ref copy so menu-item click handlers always see the latest target even
  // after the menu's onClose fires and nulls contextMenu.
  const [conflictBranches, setConflictBranches] = useState<{ local: string; incoming: string } | null>(null);

  function openContextMenu(e: React.MouseEvent, entry: StatusEntry, staged: boolean) {
    selectFile(entry, staged);
    openMenu(e, { entry, staged });
    if (entry.is_conflict) {
      setConflictBranches(null);
      invoke<{ local: string; incoming: string }>("get_conflict_branch_info", { tabId })
        .then(setConflictBranches)
        .catch(() => setConflictBranches({ local: "local", incoming: "incoming" }));
    }
  }

  async function runFileAction(
    command: string,
    filePath: string,
    confirm?: string,
  ) {
    if (confirm && !window.confirm(confirm)) return;
    try {
      await invoke(command, { tabId, filePath });
      refreshStatus();
      // Clear diff if the acted-on file was selected
      if (selected?.path === filePath) {
        setSelected(null);
        setDiff("");
      }
    } catch (e) {
      logWarn(`WorkingTreeDetail[${tabId}] ${command} failed: ${e}`);
    }
  }

  // Generation counter: incrementing on each refresh causes in-flight results
  // from a previous generation to be discarded rather than overwriting fresh state.
  const refreshGenRef = useRef(0);

  const refreshStatus = useCallback(() => {
    const gen = ++refreshGenRef.current;
    setStatus(null);
    setUntracked(null);
    setStatusError(null);
    const t0 = performance.now();
    logInfo(`WorkingTreeDetail[${tabId}] refreshStatus start gen=${gen}`);

    // Phase 1: tracked changes only (~400 ms — untracked scanning skipped).
    invoke<WorkingTreeStatus>("get_working_tree_status", { tabId })
      .then((s) => {
        if (refreshGenRef.current !== gen) return;
        const ms = Math.round(performance.now() - t0);
        logInfo(`WorkingTreeDetail[${tabId}] tracked done staged=${s.staged.length} modified=${s.unstaged.length} ms=${ms}`);
        setStatus(s);
      })
      .catch((e) => {
        if (refreshGenRef.current !== gen) return;
        logWarn(`WorkingTreeDetail[${tabId}] refreshStatus failed error=${e}`);
        setStatusError(String(e));
      });

    // Phase 2: untracked files (~2–3 s — runs in parallel, appended when ready).
    invoke<string[]>("get_untracked_files", { tabId })
      .then((paths) => {
        if (refreshGenRef.current !== gen) return;
        const ms = Math.round(performance.now() - t0);
        logInfo(`WorkingTreeDetail[${tabId}] untracked done count=${paths.length} ms=${ms}`);
        setUntracked(paths.map((path) => ({ path, old_path: null, status: "?", is_conflict: false })));
      })
      .catch(() => {
        if (refreshGenRef.current !== gen) return;
        setUntracked([]); // fail gracefully — don't block the UI
      });
  }, [tabId]);

  useEffect(() => {
    setStatus(null);
    setSelected(null);
    setDiff("");
    refreshStatus();
  }, [tabId, refreshStatus]);

  useEffect(() => {
    refreshStatus();
  // listKey changes signal a full refresh (branch switch, new commit, pull…)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  useEffect(() => {
    refreshStatus();
  // statusKey changes signal an index-only refresh (stage/unstage via watcher)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  const refreshDiff = useCallback((sel: SelectedFile) => {
    setDiffLoading(true);
    const command = sel.staged ? "get_staged_diff" : "get_unstaged_diff";
    const args = sel.staged
      ? { tabId, filePath: sel.path }
      : { tabId, filePath: sel.path, isUntracked: sel.is_untracked };
    invoke<string>(command, args)
      .then(setDiff)
      .catch(() => setDiff(""))
      .finally(() => setDiffLoading(false));
  }, [tabId]);

  useEffect(() => {
    if (!selected) { setDiff(""); return; }
    refreshDiff(selected);
  }, [selected, refreshDiff]);

  const applyPatch = useCallback(async (patch: string, reverse: boolean) => {
    try {
      await invoke("apply_patch", { tabId, patch, reverse });
      // Re-fetch both the file list and the diff for the current file
      refreshStatus();
      if (selected) refreshDiff(selected);
    } catch (e) {
      console.error("apply_patch failed:", e);
    }
  }, [tabId, selected, refreshStatus, refreshDiff]);

  function selectFile(entry: StatusEntry, staged: boolean) {
    setSelected({ path: entry.path, staged, is_untracked: entry.status === "?" });
  }

  const isEmpty =
    status !== null && untracked !== null &&
    status.staged.length === 0 && status.unstaged.length === 0 && untracked.length === 0;

  const isLoading = (status === null || untracked === null) && !statusError;
  const spinnerLabel = status === null ? "Checking tracked changes…" : "Scanning untracked files…";

  // Flat ordered list used for ArrowUp/ArrowDown navigation across both sections.
  const allFiles = status
    ? [
        ...status.staged.map((f) => ({ ...f, staged: true })),
        ...status.unstaged.map((f) => ({ ...f, staged: false })),
        ...(untracked ?? []).map((f) => ({ ...f, staged: false })),
      ]
    : [];
  const selectedIndex = allFiles.findIndex(
    (f) => f.path === selected?.path && f.staged === selected?.staged
  );

  const ctx = contextTargetRef.current?.data;
  const canCommit = status !== null && status.staged.length > 0;

  return (
    <div className="commit-detail">
      {/* Left column: staged + commit button + unstaged */}
      <div className="detail-left" style={{ width: detailLeftWidth }}>
        <div
          className="detail-files"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "d" && (e.metaKey || e.ctrlKey)) {
              if (!selected) return;
              e.preventDefault();
              invoke("open_working_tree_diff_external", { tabId, filePath: selected.path, staged: selected.staged });
              return;
            }
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            if (allFiles.length === 0) return;
            e.preventDefault();
            const next =
              e.key === "ArrowUp"
                ? Math.max(0, selectedIndex - 1)
                : Math.min(allFiles.length - 1, selectedIndex + 1);
            const f = allFiles[next];
            setSelected({ path: f.path, staged: f.staged, is_untracked: f.status === "?" });
          }}
        >
          {statusError && (
            <div className="wt-section-empty wt-section-error">{statusError}</div>
          )}
          {isEmpty && (
            <div className="wt-section-empty">Nothing to commit, working tree clean</div>
          )}

          {/* Staged section */}
          <div className="wt-section-header">
            <span className="wt-section-label">Staged</span>
            {status && <span className="wt-section-count">{status.staged.length}</span>}
          </div>
          {status && status.staged.length === 0 && (
            <div className="wt-section-hint">No staged changes.</div>
          )}
          {status && (
            <FileTree
              files={status.staged}
              selected={selected?.staged ? selected.path : null}
              onSelect={(path) => {
                const f = status.staged.find((e) => e.path === path)!;
                selectFile(f, true);
              }}
              onContextMenu={(e, path) => {
                const f = status.staged.find((e) => e.path === path)!;
                openContextMenu(e, f, true);
              }}
            />
          )}

          {/* Commit button */}
          <div className="wt-commit-area">
            <button
              className={`wt-commit-btn${canCommit ? " wt-commit-btn--enabled" : ""}`}
              disabled={!canCommit}
              onClick={() => {
                if (!canCommit) return;
                invoke("commit_staged", { tabId, message: "Commit" })
                  .then(() => refreshStatus())
                  .catch((e) => console.error("commit failed:", e));
              }}
            >
              Commit to {status?.head_branch ?? "…"}
            </button>
          </div>

          {/* Unstaged section */}
          {status && (status.unstaged.length > 0 || (untracked ?? []).length > 0) && (
            <>
              <div className="wt-section-header">
                <span className="wt-section-label">Unstaged</span>
                <span className="wt-section-count">
                  {status.unstaged.length + (untracked ?? []).length}
                  {untracked === null && "+"}
                </span>
              </div>
              <FileTree
                files={[...status.unstaged, ...(untracked ?? [])]}
                selected={selected?.staged ? null : selected?.path ?? null}
                onSelect={(path) => {
                  const allUnstaged = [...status.unstaged, ...(untracked ?? [])];
                  const f = allUnstaged.find((e) => e.path === path)!;
                  selectFile(f, false);
                }}
                onContextMenu={(e, path) => {
                  const allUnstaged = [...status.unstaged, ...(untracked ?? [])];
                  const f = allUnstaged.find((e) => e.path === path)!;
                  openContextMenu(e, f, false);
                }}
              />
            </>
          )}
          {isLoading && (
            <div className="wt-spinner-footer">
              <Loader size={12} />
              <span>{spinnerLabel}</span>
            </div>
          )}
        </div>
      </div>

      {/* Context menu overlay */}
      <Menu
        opened={!!contextMenu}
        onClose={closeMenu}
        position="right-start"
      >
        <AnchoredMenuTarget contextMenu={contextMenu} />
        <Menu.Dropdown>
          {ctx?.staged ? (
            <Menu.Item
              leftSection={<IconArrowBarToDown size={14} />}
              onClick={() => runFileAction("unstage_file", ctx.entry.path)}
            >
              Unstage
            </Menu.Item>
          ) : (
            <>
              <Menu.Item
                leftSection={<IconArrowBarToUp size={14} />}
                onClick={() => runFileAction("stage_file", ctx!.entry.path)}
              >
                {ctx?.entry.status === "?" ? "Add File" : "Stage"}
              </Menu.Item>
              {ctx?.entry.status === "?" ? (
                <Menu.Item
                  leftSection={<IconTrash size={14} />}
                  color="red"
                  onClick={() =>
                    runFileAction(
                      "delete_untracked",
                      ctx.entry.path,
                      `Delete "${ctx.entry.path}"? This cannot be undone.`,
                    )
                  }
                >
                  Delete File
                </Menu.Item>
              ) : (
                <Menu.Item
                  leftSection={<IconRotate2 size={14} />}
                  color="red"
                  onClick={() =>
                    runFileAction(
                      "discard_changes",
                      ctx!.entry.path,
                      `Discard changes to "${ctx!.entry.path}"? This cannot be undone.`,
                    )
                  }
                >
                  Discard Changes
                </Menu.Item>
              )}
            </>
          )}
          {ctx?.entry.is_conflict && (
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item leftSection={<IconGitMerge size={14} />}>
                  Resolve Conflicts
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <Menu.Item
                  onClick={() => invoke("open_mergetool_external", {
                    tabId,
                    filePath: ctx.entry.path,
                  })}
                >
                  Launch External Merge Tool
                </Menu.Item>
                <Menu.Item
                  onClick={() => {
                    invoke("resolve_conflict_local", { tabId, filePath: ctx.entry.path })
                      .then(() => refreshStatus());
                  }}
                >
                  Resolve Using Local ({conflictBranches?.local ?? "…"})
                </Menu.Item>
                <Menu.Item
                  onClick={() => {
                    invoke("resolve_conflict_incoming", { tabId, filePath: ctx.entry.path })
                      .then(() => refreshStatus());
                  }}
                >
                  Resolve Using Incoming ({conflictBranches?.incoming ?? "…"})
                </Menu.Item>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          )}
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={() => navigator.clipboard.writeText(ctx!.entry.path)}
          >
            Copy Path
          </Menu.Item>
          <Menu.Item
            leftSection={<IconGitCompare size={14} />}
            onClick={() => invoke("open_working_tree_diff_external", {
              tabId,
              filePath: ctx!.entry.path,
              staged: ctx!.staged,
            })}
          >
            Diff in External App
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <div className="resize-handle resize-handle--vertical" onMouseDown={startLeftResize} />

      {/* Right column: diff */}
      <div className="detail-diff">
        {!selected ? (
          <div className="diff-loading">
            <span className="diff-loading-text">Select a file to view diff</span>
          </div>
        ) : diffLoading ? (
          <div className="diff-loading"><Loader size="sm" /></div>
        ) : diff ? (
          <InteractiveDiffViewer
            diff={diff}
            staged={selected.staged}
            onApplyHunk={(patch) => applyPatch(patch, selected.staged)}
            onApplyLines={(patch) => applyPatch(patch, selected.staged)}
          />
        ) : (
          <div className="diff-loading">
            <span className="diff-loading-text">No diff available</span>
          </div>
        )}
      </div>
    </div>
  );
}
