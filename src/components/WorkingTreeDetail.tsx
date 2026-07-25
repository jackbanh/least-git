import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { warn as logWarn, info as logInfo } from "@tauri-apps/plugin-log";
import { ActionIcon, Loader, Menu, Textarea, Tooltip } from "@mantine/core";
import {
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconChevronRight,
  IconCopy,
  IconGitBranch,
  IconGitCompare,
  IconGitMerge,
  IconRefresh,
  IconRotate2,
  IconTrash,
} from "@tabler/icons-react";
import { useTabStore } from "../store";
import { toastError, toastSuccess } from "../toastStore";
import { useResize } from "../hooks/useResize";
import { useContextMenu } from "../hooks/useContextMenu";
import { AnchoredMenuTarget } from "./FileRow";
import { FileTree } from "./FileTree";
import { joinRepoPath } from "../lib/paths";
import { shortcutLabel, plusShortcut, deleteShortcut } from "../lib/platform";
import ErrorBoundary from "./ErrorBoundary";
import DiffErrorFallback from "./DiffErrorFallback";
import InteractiveDiffViewer from "./InteractiveDiffViewer";
import FilePreview, { type FilePreviewData } from "./FilePreview";
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
  // Untracked files arrive separately (~2–3 s later). null = never loaded for
  // this tab; the previous list is kept on screen while a rescan runs.
  const [untracked, setUntracked] = useState<StatusEntry[] | null>(null);
  const [untrackedLoading, setUntrackedLoading] = useState(false);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [diff, setDiff] = useState<string>("");
  // Untracked files have no diff; we show their contents instead.
  const [preview, setPreview] = useState<FilePreviewData | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const detailLeftWidth = useTabStore((s) => s.detailLeftWidth);
  const setDetailLeftWidth = useTabStore((s) => s.setDetailLeftWidth);
  const startLeftResize = useResize(detailLeftWidth, setDetailLeftWidth, "horizontal", 140, 9999);
  const detailStagedHeight = useTabStore((s) => s.detailStagedHeight);
  const setDetailStagedHeight = useTabStore((s) => s.setDetailStagedHeight);
  // Max is capped in CSS (`max-height`) so the unstaged pane always keeps room.
  const startStagedResize = useResize(detailStagedHeight, setDetailStagedHeight, "vertical", 80, 2000);
  const commitBoxExpanded = useTabStore((s) => s.commitBoxExpanded);
  const setCommitBoxExpanded = useTabStore((s) => s.setCommitBoxExpanded);
  const bumpListKey = useTabStore((s) => s.bumpListKey);
  // Read straight from the store rather than threading another prop through
  // CommitDetail — this is a signal for this pane only.
  const untrackedKey = useTabStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.untrackedKey ?? 0
  );
  const [commitMessage, setCommitMessage] = useState("");

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

  // Human-readable verb per mutating command, for error toasts.
  const FILE_ACTION_VERB: Record<string, string> = {
    stage_file: "stage file",
    unstage_file: "unstage file",
    discard_changes: "discard changes",
    delete_untracked: "delete file",
  };

  async function runFileAction(
    command: string,
    filePath: string,
    confirm?: string,
  ) {
    if (confirm && !window.confirm(confirm)) return;
    try {
      await invoke(command, { tabId, filePath });
      // Drop it locally first: staging or deleting an untracked file removes it
      // from the list, but the rescan takes seconds and may return a list that
      // predates this action.
      lastMutationRef.current = Date.now();
      setUntracked((prev) => prev?.filter((f) => f.path !== filePath) ?? prev);
      refreshStatus();
      // Clear diff if the acted-on file was selected
      if (selected?.path === filePath) {
        setSelected(null);
        setDiff("");
      }
    } catch (e) {
      logWarn(`WorkingTreeDetail[${tabId}] ${command} failed: ${e}`);
      toastError(`Couldn't ${FILE_ACTION_VERB[command] ?? command}`, e);
    }
  }

  // Generation counters: incrementing causes in-flight results from a previous
  // generation to be discarded rather than overwriting fresh state. The two
  // phases now run on independent schedules, so they count separately.
  const refreshGenRef = useRef(0);
  const untrackedGenRef = useRef(0);
  // When the last stage/delete completed. A scan that started before it carries
  // pre-mutation data, so its result is discarded rather than trusted.
  const lastMutationRef = useRef(0);

  // Tracked changes — cheap (~300 ms even on a 100k-file monorepo, since
  // `git status` runs with --untracked-files=no). Safe to run on every event.
  const refreshStatus = useCallback(() => {
    const gen = ++refreshGenRef.current;
    setStatus(null);
    setStatusError(null);
    const t0 = performance.now();
    logInfo(`WorkingTreeDetail[${tabId}] refreshStatus start gen=${gen}`);

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
  }, [tabId]);

  // Untracked files — expensive. Measured on a 100k-file monorepo: a full walk of
  // 27k directories, 5–9 s, with no benefit from core.untrackedCache. So it runs
  // only when new files could plausibly have appeared: first load, window focus,
  // an explicit refresh, or the Scan button. Index events (stage, unstage,
  // commit) cannot create untracked files and no longer trigger it.
  const scanUntracked = useCallback(() => {
    const gen = ++untrackedGenRef.current;
    // Deliberately not clearing `untracked` first: the scan takes seconds, and
    // blanking the list for that long flickers. Stale entries are filtered
    // against the fresh tracked status where the list is rendered.
    setUntrackedLoading(true);
    const t0 = performance.now();
    const startedAt = Date.now();
    logInfo(`WorkingTreeDetail[${tabId}] untracked scan start gen=${gen}`);

    invoke<string[]>("get_untracked_files", { tabId })
      .then((paths) => {
        if (untrackedGenRef.current !== gen) return;
        const ms = Math.round(performance.now() - t0);
        setUntrackedLoading(false);
        // A file was staged or deleted while this scan was running, so it would
        // reinstate an entry we already removed. The local list is correct —
        // keep it and wait for the next scan. (Rust coalesces concurrent scans,
        // so even a scan started after the mutation can be an older one.)
        if (lastMutationRef.current > startedAt) {
          logInfo(`WorkingTreeDetail[${tabId}] untracked result discarded — mutated mid-scan (ms=${ms})`);
          return;
        }
        logInfo(`WorkingTreeDetail[${tabId}] untracked done count=${paths.length} ms=${ms}`);
        setUntracked(paths.map((path) => ({ path, old_path: null, status: "?", is_conflict: false })));
      })
      .catch((e) => {
        if (untrackedGenRef.current !== gen) return;
        logWarn(`WorkingTreeDetail[${tabId}] untracked scan failed error=${e}`);
        // Keep whatever we last saw — a failed rescan must not wipe a good list.
        setUntracked((prev) => prev ?? []);
        setUntrackedLoading(false);
      });
  }, [tabId]);

  // Track the keys we last refreshed for, so these effects fire only on an
  // actual change. Without this they would all run on mount and on every tab
  // switch, firing identical refreshes at once — concurrent `git status` runs
  // that contend and take ~2× as long as one.
  const prevListKeyRef = useRef(listKey);
  const prevStatusKeyRef = useRef(statusKey);
  const prevUntrackedKeyRef = useRef(untrackedKey);

  useEffect(() => {
    // Runs before the effects below (declaration order), so seeding the refs
    // here also suppresses their duplicate refresh on a tab switch.
    prevListKeyRef.current = listKey;
    prevStatusKeyRef.current = statusKey;
    prevUntrackedKeyRef.current = untrackedKey;
    setStatus(null);
    setUntracked(null); // stale entries belong to the tab we just left
    setSelected(null);
    setDiff("");
    refreshStatus();
    scanUntracked(); // no list for this tab yet, so pay for one scan
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, refreshStatus, scanUntracked]);

  useEffect(() => {
    if (listKey === prevListKeyRef.current) return;
    prevListKeyRef.current = listKey;
    refreshStatus();
  // listKey changes signal a full refresh (branch switch, new commit, pull…).
  // Tracked only: none of those create untracked files, and an explicit refresh
  // bumps untrackedKey separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  useEffect(() => {
    if (statusKey === prevStatusKeyRef.current) return;
    prevStatusKeyRef.current = statusKey;
    refreshStatus();
  // statusKey changes signal an index-only refresh (stage/unstage via watcher)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  useEffect(() => {
    if (untrackedKey === prevUntrackedKeyRef.current) return;
    prevUntrackedKeyRef.current = untrackedKey;
    scanUntracked();
  // untrackedKey changes are the explicit "look for new files" signal: window
  // focus (cooldown-limited) and the toolbar/menu Refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [untrackedKey]);

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
    if (!selected) { setDiff(""); setPreview(null); return; }
    // Untracked (new) files have no diff — fetch their contents for a preview.
    if (selected.is_untracked) {
      setDiff("");
      setPreview(null);
      setDiffLoading(true);
      invoke<FilePreviewData>("read_file_preview", { tabId, filePath: selected.path })
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setDiffLoading(false));
      return;
    }
    setPreview(null);
    refreshDiff(selected);
  }, [selected, refreshDiff, tabId]);

  const applyPatch = useCallback(async (patch: string, reverse: boolean) => {
    try {
      await invoke("apply_patch", { tabId, patch, reverse });
      // Re-fetch both the file list and the diff for the current file
      refreshStatus();
      if (selected) refreshDiff(selected);
    } catch (e) {
      toastError(reverse ? "Couldn't unstage changes" : "Couldn't stage changes", e);
    }
  }, [tabId, selected, refreshStatus, refreshDiff]);

  function selectFile(entry: StatusEntry, staged: boolean) {
    setSelected({ path: entry.path, staged, is_untracked: entry.status === "?" });
  }

  // The untracked list survives a refresh and the Rust side coalesces concurrent
  // scans, so it can be one scan behind. The tracked status is never coalesced —
  // anything it already accounts for (a file staged mid-scan) is dropped here.
  const untrackedFiles = useMemo(() => {
    if (!untracked) return [];
    if (!status) return untracked;
    const tracked = new Set([...status.staged, ...status.unstaged].map((f) => f.path));
    return untracked.filter((f) => !tracked.has(f.path));
  }, [untracked, status]);

  const isLoading = (status === null || untrackedLoading) && !statusError;
  const spinnerLabel = status === null ? "Checking tracked changes…" : "Scanning untracked files…";

  // Flat ordered list used for ArrowUp/ArrowDown navigation across both sections.
  const allFiles = status
    ? [
        ...status.staged.map((f) => ({ ...f, staged: true })),
        ...status.unstaged.map((f) => ({ ...f, staged: false })),
        ...untrackedFiles.map((f) => ({ ...f, staged: false })),
      ]
    : [];
  const selectedIndex = allFiles.findIndex(
    (f) => f.path === selected?.path && f.staged === selected?.staged
  );

  const ctx = contextTargetRef.current?.data;
  const hasStaged = status !== null && status.staged.length > 0;
  const canCommit = hasStaged && commitMessage.trim().length > 0;

  function doCommit() {
    if (!canCommit) return;
    invoke("commit_staged", { tabId, message: commitMessage.trim() })
      .then(() => {
        setCommitMessage("");
        refreshStatus();      // clear the now-committed staged list
        bumpListKey(tabId);   // surface the new commit in history immediately
        toastSuccess("Commit created");
      })
      .catch((e) => toastError("Commit failed", e));
  }

  return (
    <div className="commit-detail">
      {/* Left column: staged + commit button + unstaged */}
      <div className="detail-left" style={{ width: detailLeftWidth }}>
        <div
          className="detail-files-panes"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "d" && (e.metaKey || e.ctrlKey)) {
              if (!selected) return;
              e.preventDefault();
              invoke("open_working_tree_diff_external", { tabId, filePath: selected.path, staged: selected.staged });
              return;
            }
            // Per-file actions on the selected file, mirroring the context menu.
            // Only apply to unstaged/untracked files (staged files only offer Unstage).
            if ((e.metaKey || e.ctrlKey) && selected && !selected.staged) {
              // Stage / Add — Ctrl+Plus / ⌘+
              if (e.key === "+" || e.key === "=") {
                e.preventDefault();
                runFileAction("stage_file", selected.path);
                return;
              }
              // Discard Changes — Ctrl+Shift+R / ⇧⌘R (tracked files only)
              if (e.shiftKey && e.key.toLowerCase() === "r" && !selected.is_untracked) {
                e.preventDefault();
                runFileAction("discard_changes", selected.path, `Discard changes to "${selected.path}"? This cannot be undone.`);
                return;
              }
              // Delete File — Ctrl+Del / ⌘⌫ (untracked files only)
              if ((e.key === "Delete" || e.key === "Backspace") && selected.is_untracked) {
                e.preventDefault();
                runFileAction("delete_untracked", selected.path, `Delete "${selected.path}"? This cannot be undone.`);
                return;
              }
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
          {/* Staged pane (resizable height) */}
          <div className="wt-pane wt-pane--staged" style={{ height: detailStagedHeight }}>
            <div className="wt-section-header">
              <span className="wt-section-label">Staged</span>
              {status && <span className="wt-section-count">{status.staged.length}</span>}
            </div>
            <div className="wt-pane-scroll">
              {statusError && (
                <div className="wt-section-empty wt-section-error">{statusError}</div>
              )}
              {status && status.staged.length === 0 && !statusError && (
                <div className="wt-section-hint">No staged changes.</div>
              )}
              {status && (
                <FileTree
                  files={status.staged}
                  selected={selected?.staged ? selected.path : null}
                  showTooltips={!contextMenu}
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
            </div>

            {/* Commit accordion pinned to the bottom of the staged pane */}
            <div className="wt-commit-box">
              <button
                type="button"
                className="wt-commit-toggle"
                aria-expanded={commitBoxExpanded}
                onClick={() => setCommitBoxExpanded(!commitBoxExpanded)}
              >
                <IconChevronRight
                  size={13}
                  className={`wt-commit-chevron${commitBoxExpanded ? " wt-commit-chevron--open" : ""}`}
                />
                <span className="wt-commit-toggle-label">Commit</span>
                {hasStaged && <span className="wt-commit-toggle-count">{status!.staged.length}</span>}
              </button>
              {commitBoxExpanded && (
                <div className="wt-commit-body">
                  <div className="wt-commit-branch">
                    <IconGitBranch size={12} />
                    <span>
                      Committing to <strong>{status?.head_branch ?? "…"}</strong>
                    </span>
                  </div>
                  <Textarea
                    classNames={{ root: "wt-commit-input-root", input: "wt-commit-input" }}
                    placeholder="Commit message"
                    autosize
                    minRows={2}
                    maxRows={10}
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      // Keep arrow/⌘D file-nav from hijacking edits in this field.
                      e.stopPropagation();
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        doCommit();
                      }
                    }}
                  />
                  <button
                    className={`wt-commit-btn${canCommit ? " wt-commit-btn--enabled" : ""}`}
                    disabled={!canCommit}
                    onClick={doCommit}
                    title={`Commit (${shortcutLabel("Enter")})`}
                  >
                    Commit
                    <span className="wt-commit-kbd">{shortcutLabel("Enter")}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Horizontal resize handle between the two panes */}
          <div className="resize-handle resize-handle--horizontal" onMouseDown={startStagedResize} />

          {/* Unstaged pane (fills remaining height) */}
          <div className="wt-pane wt-pane--unstaged">
            <div className="wt-section-header">
              <span className="wt-section-label">Unstaged</span>
              <div className="wt-section-actions">
                {status && (
                  <span className="wt-section-count">
                    {status.unstaged.length + untrackedFiles.length}
                    {untrackedLoading && "+"}
                  </span>
                )}
                {/* New files are invisible to the FS watcher (it covers .git/
                    only) and the scan is too slow to run on every refresh, so
                    this is the manual way to go looking for them. */}
                <Tooltip label="Scan for new files" withArrow openDelay={400}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label="Scan for new files"
                    loading={untrackedLoading}
                    onClick={scanUntracked}
                  >
                    <IconRefresh size={13} />
                  </ActionIcon>
                </Tooltip>
              </div>
            </div>
            <div className="wt-pane-scroll">
              {status && status.unstaged.length === 0 && untrackedFiles.length === 0 && !untrackedLoading && (
                <div className="wt-section-hint">
                  {status.staged.length === 0 && !statusError
                    ? "Working tree clean."
                    : "No unstaged changes."}
                </div>
              )}
              {status && (
                <FileTree
                  files={[...status.unstaged, ...untrackedFiles]}
                  selected={selected?.staged ? null : selected?.path ?? null}
                  showTooltips={!contextMenu}
                  onSelect={(path) => {
                    const allUnstaged = [...status.unstaged, ...untrackedFiles];
                    const f = allUnstaged.find((e) => e.path === path)!;
                    selectFile(f, false);
                  }}
                  onContextMenu={(e, path) => {
                    const allUnstaged = [...status.unstaged, ...untrackedFiles];
                    const f = allUnstaged.find((e) => e.path === path)!;
                    openContextMenu(e, f, false);
                  }}
                />
              )}
              {isLoading && (
                <div className="wt-spinner-footer">
                  <Loader size={12} />
                  <span>{spinnerLabel}</span>
                </div>
              )}
            </div>
          </div>
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
                rightSection={<span className="menu-kbd">{plusShortcut}</span>}
                onClick={() => runFileAction("stage_file", ctx!.entry.path)}
              >
                {ctx?.entry.status === "?" ? "Add File" : "Stage"}
              </Menu.Item>
              {ctx?.entry.status === "?" ? (
                <Menu.Item
                  leftSection={<IconTrash size={14} />}
                  rightSection={<span className="menu-kbd">{deleteShortcut}</span>}
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
                  rightSection={<span className="menu-kbd">{shortcutLabel("R", { shift: true })}</span>}
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
                  }).catch((e) => toastError("Couldn't launch merge tool", e))}
                >
                  Launch External Merge Tool
                </Menu.Item>
                <Menu.Item
                  onClick={() => {
                    invoke("resolve_conflict_local", { tabId, filePath: ctx.entry.path })
                      .then(() => refreshStatus())
                      .catch((e) => toastError("Couldn't resolve conflict", e));
                  }}
                >
                  Resolve Using Local ({conflictBranches?.local ?? "…"})
                </Menu.Item>
                <Menu.Item
                  onClick={() => {
                    invoke("resolve_conflict_incoming", { tabId, filePath: ctx.entry.path })
                      .then(() => refreshStatus())
                      .catch((e) => toastError("Couldn't resolve conflict", e));
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
            Copy Relative Path
          </Menu.Item>
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={() => navigator.clipboard.writeText(joinRepoPath(tabId, ctx!.entry.path))}
          >
            Copy Full Path
          </Menu.Item>
          <Menu.Item
            leftSection={<IconGitCompare size={14} />}
            rightSection={<span className="menu-kbd">{shortcutLabel("D")}</span>}
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
        <ErrorBoundary
          resetKeys={[selected?.path, selected?.staged]}
          fallback={(_e, reset) => <DiffErrorFallback reset={reset} />}
        >
          {!selected ? (
            <div className="diff-loading">
              <span className="diff-loading-text">Select a file to view diff</span>
            </div>
          ) : diffLoading ? (
            <div className="diff-loading"><Loader size="sm" /></div>
          ) : selected.is_untracked ? (
            preview ? (
              <FilePreview path={selected.path} preview={preview} />
            ) : (
              <div className="diff-loading">
                <span className="diff-loading-text">No preview available</span>
              </div>
            )
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
        </ErrorBoundary>
      </div>
    </div>
  );
}
