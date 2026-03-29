import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import DiffViewer from "./DiffViewer";
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

  useEffect(() => {
    setStatus(null);
    setSelected(null);
    setDiff("");
    invoke<WorkingTreeStatus>("get_working_tree_status", { tabId })
      .then(setStatus)
      .catch((e) => console.error("get_working_tree_status failed:", e));
  }, [tabId]);

  useEffect(() => {
    if (!selected) {
      setDiff("");
      return;
    }
    setDiffLoading(true);
    const command = selected.staged ? "get_staged_diff" : "get_unstaged_diff";
    const args = selected.staged
      ? { tabId, filePath: selected.path }
      : { tabId, filePath: selected.path, isUntracked: selected.is_untracked };

    invoke<string>(command, args)
      .then(setDiff)
      .catch(() => setDiff(""))
      .finally(() => setDiffLoading(false));
  }, [selected, tabId]);

  function selectFile(entry: StatusEntry, staged: boolean) {
    setSelected({
      path: entry.path,
      staged,
      is_untracked: entry.status === "?",
    });
  }

  const isEmpty =
    status && status.staged.length === 0 && status.unstaged.length === 0;

  return (
    <div className="working-tree-detail">
      <div className="detail-meta">
        <span className="wt-title">Uncommitted Changes</span>
        {status && (
          <span className="wt-counts">
            {status.staged.length} staged · {status.unstaged.length} unstaged
          </span>
        )}
      </div>

      <div className="detail-body">
        <div className="detail-files">
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

        <div className="detail-diff">
          {!selected ? (
            <div className="diff-loading">Select a file to view diff</div>
          ) : diffLoading ? (
            <div className="diff-loading">Loading diff…</div>
          ) : diff ? (
            <DiffViewer diff={diff} />
          ) : (
            <div className="diff-loading">No diff available</div>
          )}
        </div>
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
      onClick={onClick}
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
