import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

export default function WorkingTreeDetail({ tabId }: { tabId: string }) {
  const [status, setStatus] = useState<WorkingTreeStatus | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);

  const refreshStatus = useCallback(() => {
    invoke<WorkingTreeStatus>("get_working_tree_status", { tabId })
      .then(setStatus)
      .catch((e) => console.error("get_working_tree_status failed:", e));
  }, [tabId]);

  useEffect(() => {
    setStatus(null);
    setSelected(null);
    setDiff("");
    refreshStatus();
  }, [tabId, refreshStatus]);

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
    <div className="commit-detail">
      <div className="detail-left">
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
          {!status && <div className="wt-section-empty">Loading…</div>}
          {isEmpty && (
            <div className="wt-section-empty">Nothing to commit, working tree clean</div>
          )}
          {status && status.staged.length > 0 && (
            <>
              <div className="wt-section-header">Staged</div>
              {status.staged.map((f) => (
                <FileRow
                  key={`staged:${f.path}`}
                  file={f}
                  isSelected={selected?.path === f.path && selected.staged}
                  onClick={() => selectFile(f, true)}
                />
              ))}
            </>
          )}
          {status && status.unstaged.length > 0 && (
            <>
              <div className="wt-section-header">Unstaged</div>
              {status.unstaged.map((f) => (
                <FileRow
                  key={`unstaged:${f.path}`}
                  file={f}
                  isSelected={selected?.path === f.path && !selected.staged}
                  onClick={() => selectFile(f, false)}
                />
              ))}
            </>
          )}
        </div>

        <div className="detail-meta">
          <span className="wt-title">Uncommitted Changes</span>
          {status && (
            <span className="wt-counts">
              {status.staged.length} staged · {status.unstaged.length} unstaged
            </span>
          )}
        </div>
      </div>

      <div className="resize-handle resize-handle--vertical" />

      <div className="detail-diff">
        {!selected ? (
          <div className="diff-loading">Select a file to view diff</div>
        ) : diffLoading ? (
          <div className="diff-loading">Loading diff…</div>
        ) : diff ? (
          <InteractiveDiffViewer
            diff={diff}
            staged={selected.staged}
            onApplyHunk={(patch) => applyPatch(patch, selected.staged)}
            onApplyLines={(patch) => applyPatch(patch, selected.staged)}
          />
        ) : (
          <div className="diff-loading">No diff available</div>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  isSelected,
  onClick,
}: {
  file: StatusEntry;
  isSelected: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <div
      className={`file-row${isSelected ? " file-row--selected" : ""}`}
      onClick={(e) => {
        (e.currentTarget.closest(".detail-files") as HTMLElement | null)?.focus();
        onClick();
      }}
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
