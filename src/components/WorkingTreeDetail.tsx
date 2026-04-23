import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { warn as logWarn, info as logInfo } from "@tauri-apps/plugin-log";
import { Loader, Menu } from "@mantine/core";
import {
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconRotate2,
  IconTrash,
} from "@tabler/icons-react";
import DetailLayout from "./DetailLayout";
import InteractiveDiffViewer from "./InteractiveDiffViewer";
import "./CommitDetail.css";
import "./WorkingTreeDetail.css";

interface StatusEntry {
  path: string;
  old_path: string | null;
  status: string;
}

interface WorkingTreeStatus {
  staged: StatusEntry[];
  unstaged: StatusEntry[];
}

interface SelectedFile {
  path: string;
  staged: boolean;
  is_untracked: boolean;
}

export default function WorkingTreeDetail({ tabId, listKey, statusKey }: { tabId: string; listKey: number; statusKey: number }) {
  const [status, setStatus] = useState<WorkingTreeStatus | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);

  // ── Context menu ────────────────────────────────────────────────────────
  interface ContextMenuState { x: number; y: number; entry: StatusEntry; staged: boolean }
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Ref copy so menu-item click handlers always see the latest target even
  // after the menu's onClose fires and nulls contextMenu.
  const contextTargetRef = useRef<ContextMenuState | null>(null);

  function openContextMenu(e: React.MouseEvent, entry: StatusEntry, staged: boolean) {
    e.preventDefault();
    const state = { x: e.clientX, y: e.clientY, entry, staged };
    contextTargetRef.current = state;
    setContextMenu(state);
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

  // Synchronous guard: drops concurrent refreshes so at most one git status
  // call is in flight at a time (important on slow monorepos).
  const isRefreshingRef = useRef(false);

  const refreshStatus = useCallback(() => {
    if (isRefreshingRef.current) {
      logWarn(`WorkingTreeDetail[${tabId}] refreshStatus skipped — already in flight`);
      return;
    }
    isRefreshingRef.current = true;
    const t0 = performance.now();
    logInfo(`WorkingTreeDetail[${tabId}] refreshStatus start`);
    invoke<WorkingTreeStatus>("get_working_tree_status", { tabId })
      .then((s) => {
        const ms = Math.round(performance.now() - t0);
        logInfo(`WorkingTreeDetail[${tabId}] refreshStatus done staged=${s.staged.length} unstaged=${s.unstaged.length} ms=${ms}`);
        setStatus(s);
      })
      .catch((e) => {
        const ms = Math.round(performance.now() - t0);
        logWarn(`WorkingTreeDetail[${tabId}] refreshStatus failed ms=${ms} error=${e}`);
      })
      .finally(() => {
        isRefreshingRef.current = false;
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

  const isEmpty = status && status.staged.length === 0 && status.unstaged.length === 0;

  // Flat ordered list used for ArrowUp/ArrowDown navigation across both sections.
  const allFiles = status
    ? [
        ...status.staged.map((f) => ({ ...f, staged: true })),
        ...status.unstaged.map((f) => ({ ...f, staged: false })),
      ]
    : [];
  const selectedIndex = allFiles.findIndex(
    (f) => f.path === selected?.path && f.staged === selected?.staged
  );

  return (
    <DetailLayout
      left={
        <>
          <div
            className="detail-files"
            tabIndex={0}
            onKeyDown={(e) => {
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
            {!status && <div className="wt-section-empty"><Loader size="xs" /></div>}
            {isEmpty && (
              <div className="wt-section-empty">Nothing to commit, working tree clean</div>
            )}
            {status && status.staged.length > 0 && (
              <>
                <div className="wt-section-header">
                  <span className="wt-section-label">Staged</span>
                  <span className="wt-section-count">{status.staged.length}</span>
                </div>
                {status.staged.map((f) => (
                  <FileRow
                    key={`staged:${f.path}`}
                    file={f}
                    isSelected={selected?.path === f.path && selected.staged}
                    onClick={() => selectFile(f, true)}
                    onContextMenu={(e) => openContextMenu(e, f, true)}
                  />
                ))}
              </>
            )}
            {status && status.unstaged.length > 0 && (
              <>
                <div className="wt-section-header">
                  <span className="wt-section-label">Changes</span>
                  <span className="wt-section-count">{status.unstaged.length}</span>
                </div>
                {status.unstaged.map((f) => (
                  <FileRow
                    key={`unstaged:${f.path}`}
                    file={f}
                    isSelected={selected?.path === f.path && !selected.staged}
                    onClick={() => selectFile(f, false)}
                    onContextMenu={(e) => openContextMenu(e, f, false)}
                  />
                ))}
              </>
            )}
          </div>

          <div className="wt-meta">
            <span className="wt-title">Uncommitted Changes</span>
            {status && (
              <span className="wt-counts">
                {status.staged.length} staged · {status.unstaged.length} unstaged
              </span>
            )}
          </div>
        </>
      }
      overlay={
        <Menu
          opened={!!contextMenu}
          onClose={() => setContextMenu(null)}
          position="right-start"
        >
          <Menu.Target>
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
            {contextTargetRef.current?.staged ? (
              // ── Staged file ──────────────────────────────────────────────
              <Menu.Item
                leftSection={<IconArrowBarToDown size={14} />}
                onClick={() => runFileAction("unstage_file", contextTargetRef.current!.entry.path)}
              >
                Unstage
              </Menu.Item>
            ) : (
              // ── Unstaged / untracked file ────────────────────────────────
              <>
                <Menu.Item
                  leftSection={<IconArrowBarToUp size={14} />}
                  onClick={() => runFileAction("stage_file", contextTargetRef.current!.entry.path)}
                >
                  {contextTargetRef.current?.entry.status === "?" ? "Add File" : "Stage"}
                </Menu.Item>
                {contextTargetRef.current?.entry.status === "?" ? (
                  <Menu.Item
                    leftSection={<IconTrash size={14} />}
                    color="red"
                    onClick={() =>
                      runFileAction(
                        "delete_untracked",
                        contextTargetRef.current!.entry.path,
                        `Delete "${contextTargetRef.current!.entry.path}"? This cannot be undone.`,
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
                        contextTargetRef.current!.entry.path,
                        `Discard changes to "${contextTargetRef.current!.entry.path}"? This cannot be undone.`,
                      )
                    }
                  >
                    Discard Changes
                  </Menu.Item>
                )}
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      }
      diff={
        !selected ? (
          <div className="diff-loading">Select a file to view diff</div>
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
          <div className="diff-loading">No diff available</div>
        )
      }
    />
  );
}

function FileRow({
  file,
  isSelected,
  onClick,
  onContextMenu,
}: {
  file: StatusEntry;
  isSelected: boolean | undefined;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`file-row${isSelected ? " file-row--selected" : ""}`}
      onClick={(e) => {
        (e.currentTarget.closest(".detail-files") as HTMLElement | null)?.focus();
        onClick();
      }}
      onContextMenu={onContextMenu}
    >
      <span className={`file-status file-status--${file.status.toLowerCase()}`}>
        {file.status}
      </span>
      <span className="file-path" title={file.path}>
        {file.path}
      </span>
    </div>
  );
}
