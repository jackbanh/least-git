import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { Loader } from "@mantine/core";
import { useTabStore } from "../store";
import { useResize } from "../hooks/useResize";
import DetailLayout from "./DetailLayout";
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

function formatDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${day} ${hh}:${min}`;
}

// Routing shell — always calls hooks in the same order, then delegates.
export default function CommitDetail({ tabId, listKey, statusKey }: { tabId: string; listKey: number; statusKey: number }) {
  const selectedOid = useTabStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.selectedOid ?? null
  );

  if (selectedOid === UNCOMMITTED) {
    return <WorkingTreeDetail tabId={tabId} listKey={listKey} statusKey={statusKey} />;
  }

  return <CommitDetailInner tabId={tabId} selectedOid={selectedOid} />;
}

function CommitDetailInner({
  tabId,
  selectedOid,
}: {
  tabId: string;
  selectedOid: string | null;
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const metaPanelHeight = useTabStore((s) => s.metaPanelHeight);
  const setMetaPanelHeight = useTabStore((s) => s.setMetaPanelHeight);
  const startMetaResize = useResize(metaPanelHeight, setMetaPanelHeight, "vertical", 80, 320, true);

  // Reset file selection when switching commits so we don't carry over a
  // file from the previous commit into the new one's file list.
  useEffect(() => {
    setSelectedFile(null);
  }, [selectedOid]);

  // Commit metadata — content-addressed by OID, never changes.
  // staleTime: Infinity → no background refetch on revisit.
  // gcTime: Infinity   → stays in memory for the whole session.
  const { data: detail, isLoading: detailLoading } = useQuery<CommitDetailData>({
    queryKey: ["commit-detail", tabId, selectedOid],
    queryFn: () =>
      invoke<CommitDetailData>("get_commit_detail", { tabId, oid: selectedOid }),
    enabled: !!selectedOid,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // File diff — also content-addressed. Revisiting any (commit, file) pair is
  // instant after the first load.
  const { data: diff = "", isLoading: diffLoading } = useQuery<string>({
    queryKey: ["file-diff", tabId, selectedOid, selectedFile],
    queryFn: () =>
      invoke<string>("get_file_diff", {
        tabId,
        oid: selectedOid,
        filePath: selectedFile,
      }),
    enabled: !!selectedOid && !!selectedFile,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (!selectedOid || (!detail && detailLoading)) {
    return (
      <div className="detail-empty">
        {selectedOid
          ? <Loader size="sm" />
          : "Select a commit to view details"}
      </div>
    );
  }

  if (!detail) {
    // selectedOid set but query failed / returned nothing
    return <div className="detail-empty">Failed to load commit.</div>;
  }

  return (
    <DetailLayout
      left={
        <>
          <div
            className="detail-files"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              const idx = detail.files.findIndex((f) => f.path === selectedFile);
              const next =
                e.key === "ArrowUp"
                  ? Math.max(0, idx - 1)
                  : Math.min(detail.files.length - 1, idx + 1);
              setSelectedFile(detail.files[next]?.path ?? null);
            }}
          >
            {detail.files.map((file) => (
              <div
                key={file.path}
                className={`file-row${selectedFile === file.path ? " file-row--selected" : ""}`}
                onClick={(e) => {
                  setSelectedFile(file.path);
                  (e.currentTarget.closest(".detail-files") as HTMLElement | null)?.focus();
                }}
              >
                <span className={`file-status file-status--${file.status.toLowerCase()}`}>
                  {file.status}
                </span>
                <span className="file-path" title={file.path}>
                  <FilePathDisplay path={file.path} />
                </span>
              </div>
            ))}
          </div>

          <div className="resize-handle resize-handle--horizontal" onMouseDown={startMetaResize} />

          <div className="detail-meta" style={{ height: metaPanelHeight }}>
            <div className="detail-message">
              <div className="detail-commit-title">{detail.summary}</div>
              {detail.body && (
                <div className="detail-commit-body">
                  <Markdown>{detail.body}</Markdown>
                </div>
              )}
              <div className="detail-meta-footer">
                <span className="detail-oid">{detail.oid.slice(0, 7)}</span>
                <span className="detail-meta-sep">·</span>
                <span className="detail-date">{formatDateTime(detail.timestamp)}</span>
                <span className="detail-meta-sep">·</span>
                <span className="detail-author">
                  {detail.author_name}
                </span>
              </div>
            </div>
          </div>
        </>
      }
      diff={
        diffLoading ? (
          <div className="diff-loading"><Loader size="sm" /></div>
        ) : diff ? (
          <DiffViewer diff={diff} />
        ) : (
          <div className="diff-loading">
            <span className="diff-loading-text">Select a file to view diff</span>
          </div>
        )
      }
    />
  );
}

function FilePathDisplay({ path }: { path: string }) {
  const parts = path.split("/");
  const name = parts.pop()!;
  const dir = parts.join("/");
  return (
    <>
      {dir && <span className="file-path-dir">{dir}/</span>}
      <span className="file-path-name">{name}</span>
    </>
  );
}
