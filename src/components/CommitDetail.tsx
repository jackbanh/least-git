import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "../store";
import DiffViewer from "./DiffViewer";
import WorkingTreeDetail from "./WorkingTreeDetail";
import "./CommitDetail.css";

export const UNCOMMITTED = "UNCOMMITTED";

interface ChangedFile {
  path: string;
  old_path: string | null;
  status: string;
}

interface CommitDetailData {
  oid: string;
  summary: string;
  body: string;
  author_name: string;
  author_email: string;
  timestamp: number;
  files: ChangedFile[];
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Routing shell — always calls hooks in the same order, then delegates.
export default function CommitDetail({ tabId }: { tabId: string }) {
  const selectedOid = useTabStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.selectedOid ?? null
  );

  if (selectedOid === UNCOMMITTED) {
    return <WorkingTreeDetail tabId={tabId} />;
  }

  return <CommitDetailInner tabId={tabId} selectedOid={selectedOid} />;
}

// Inner component — hooks always run unconditionally here.
function CommitDetailInner({
  tabId,
  selectedOid,
}: {
  tabId: string;
  selectedOid: string | null;
}) {
  const [detail, setDetail] = useState<CommitDetailData | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    if (!selectedOid) {
      setDetail(null);
      setSelectedFile(null);
      setDiff("");
      return;
    }
    setDetail(null);
    setSelectedFile(null);
    setDiff("");
    invoke<CommitDetailData>("get_commit_detail", { tabId, oid: selectedOid })
      .then((d) => {
        setDetail(d);
        setSelectedFile(d.files[0]?.path ?? null);
      })
      .catch((e) => console.error("get_commit_detail failed:", e));
  }, [tabId, selectedOid]);

  useEffect(() => {
    if (!selectedOid || !selectedFile) {
      setDiff("");
      return;
    }
    setDiffLoading(true);
    invoke<string>("get_file_diff", { tabId, oid: selectedOid, filePath: selectedFile })
      .then(setDiff)
      .catch(() => setDiff(""))
      .finally(() => setDiffLoading(false));
  }, [tabId, selectedOid, selectedFile]);

  if (!selectedOid || !detail) {
    return (
      <div className="detail-empty">
        {selectedOid ? "Loading…" : "Select a commit to view details"}
      </div>
    );
  }

  return (
    <div className="commit-detail">
      <div className="detail-meta">
        <span className="detail-oid">{detail.oid.slice(0, 7)}</span>
        <span className="detail-author">
          {detail.author_name}{" "}
          <span className="detail-email">&lt;{detail.author_email}&gt;</span>
        </span>
        <span className="detail-date">{formatDate(detail.timestamp)}</span>
        <span className="detail-summary">{detail.summary}</span>
      </div>

      <div className="detail-body">
        <div className="detail-files">
          {detail.files.map((file) => (
            <div
              key={file.path}
              className={`file-row${selectedFile === file.path ? " file-row--selected" : ""}`}
              onClick={() => setSelectedFile(file.path)}
            >
              <span className={`file-status file-status--${file.status.toLowerCase()}`}>
                {file.status}
              </span>
              <span className="file-path" title={file.path}>
                {file.path}
              </span>
            </div>
          ))}
        </div>

        <div className="detail-diff">
          {diffLoading ? (
            <div className="diff-loading">Loading diff…</div>
          ) : diff ? (
            <DiffViewer diff={diff} />
          ) : (
            <div className="diff-loading">Select a file to view diff</div>
          )}
        </div>
      </div>
    </div>
  );
}
