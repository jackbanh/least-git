import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { Loader, Menu } from "@mantine/core";
import { IconCopy, IconGitCompare, IconFileDescription } from "@tabler/icons-react";
import { useTabStore } from "../store";
import { useResize } from "../hooks/useResize";
import { useContextMenu } from "../hooks/useContextMenu";
import { AnchoredMenuTarget } from "./FileRow";
import { FileTree } from "./FileTree";
import { joinRepoPath } from "../lib/paths";
import { shortcutLabel } from "../lib/platform";
import DiffViewer from "./DiffViewer";
import WorkingTreeDetail from "./WorkingTreeDetail";
import "./CommitDetail.css";

export const UNCOMMITTED = "UNCOMMITTED";
const DESCRIPTION_KEY = "__description__";

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
  // null = show description; string = show file diff
  const [selectedFile, setSelectedFile] = useState<string | null>(DESCRIPTION_KEY);

  const { contextMenu, contextTargetRef, open: openMenu, close: closeMenu } = useContextMenu<ChangedFile>();

  function openContextMenu(e: React.MouseEvent, file: ChangedFile) {
    setSelectedFile(file.path);
    openMenu(e, file);
  }

  const detailLeftWidth = useTabStore((s) => s.detailLeftWidth);
  const setDetailLeftWidth = useTabStore((s) => s.setDetailLeftWidth);
  const startLeftResize = useResize(detailLeftWidth, setDetailLeftWidth, "horizontal", 140, 9999);

  // Reset to description view when switching commits
  useEffect(() => {
    setSelectedFile(DESCRIPTION_KEY);
  }, [selectedOid]);

  const { data: detail, isLoading: detailLoading } = useQuery<CommitDetailData>({
    queryKey: ["commit-detail", tabId, selectedOid],
    queryFn: () =>
      invoke<CommitDetailData>("get_commit_detail", { tabId, oid: selectedOid }),
    enabled: !!selectedOid,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const { data: diff = "", isLoading: diffLoading } = useQuery<string>({
    queryKey: ["file-diff", tabId, selectedOid, selectedFile],
    queryFn: () =>
      invoke<string>("get_file_diff", {
        tabId,
        oid: selectedOid,
        filePath: selectedFile,
      }),
    enabled: !!selectedOid && !!selectedFile && selectedFile !== DESCRIPTION_KEY,
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
    return <div className="detail-empty">Failed to load commit.</div>;
  }

  const showDescription = selectedFile === DESCRIPTION_KEY;
  const ctx = contextTargetRef.current?.data;

  return (
    <div className="commit-detail">
      <div className="detail-left" style={{ width: detailLeftWidth }}>
        {/* Files header */}
        <div className="detail-files-header">
          <span className="detail-files-header-label">Changes</span>
        </div>

        <div
          className="detail-files"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "d" && (e.metaKey || e.ctrlKey)) {
              if (!selectedFile || showDescription) return;
              e.preventDefault();
              invoke("open_diff_external", { tabId, oid: detail.oid, filePath: selectedFile });
              return;
            }
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            // Index 0 = description row, 1..N = files (original backend order)
            const allItems = [DESCRIPTION_KEY, ...detail.files.map((f) => f.path)];
            const idx = allItems.indexOf(selectedFile ?? DESCRIPTION_KEY);
            const next =
              e.key === "ArrowUp"
                ? Math.max(0, idx - 1)
                : Math.min(allItems.length - 1, idx + 1);
            setSelectedFile(allItems[next]);
          }}
        >
          {/* Description pseudo-row */}
          <DescriptionRow
            detail={detail}
            selected={showDescription}
            onSelect={() => setSelectedFile(DESCRIPTION_KEY)}
          />

          <FileTree
            key={detail.oid}
            files={detail.files}
            selected={showDescription ? null : selectedFile}
            showTooltips={!contextMenu}
            onSelect={(path) => setSelectedFile(path)}
            onContextMenu={(e, path) => {
              const file = detail.files.find((f) => f.path === path)!;
              setSelectedFile(path);
              openContextMenu(e, file);
            }}
          />
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
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={() => navigator.clipboard.writeText(ctx!.path)}
          >
            Copy Relative Path
          </Menu.Item>
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={() => navigator.clipboard.writeText(joinRepoPath(tabId, ctx!.path))}
          >
            Copy Full Path
          </Menu.Item>
          <Menu.Item
            leftSection={<IconGitCompare size={14} />}
            rightSection={<span className="menu-kbd">{shortcutLabel("D")}</span>}
            onClick={() => invoke("open_diff_external", {
              tabId,
              oid: detail.oid,
              filePath: ctx!.path,
            })}
          >
            Diff in External App
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <div className="resize-handle resize-handle--vertical" onMouseDown={startLeftResize} />

      <div className="detail-diff">
        {showDescription ? (
          <DescriptionPane detail={detail} />
        ) : diffLoading ? (
          <div className="diff-loading"><Loader size="sm" /></div>
        ) : diff ? (
          <DiffViewer diff={diff} />
        ) : (
          <div className="diff-loading">
            <span className="diff-loading-text">Select a file to view diff</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DescriptionRow({
  detail,
  selected,
  onSelect,
}: {
  detail: CommitDetailData;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`file-row description-row${selected ? " file-row--selected" : ""}`}
      onClick={onSelect}
    >
      <IconFileDescription
        size={12}
        strokeWidth={1.5}
        style={{ flexShrink: 0, opacity: 0.6 }}
      />
      <span className="description-row-label">Description</span>
      <span className="description-row-sha">{detail.oid.slice(0, 7)}</span>
    </div>
  );
}

function DescriptionPane({ detail }: { detail: CommitDetailData }) {
  return (
    <div className="description-pane">
      <div className="description-pane-header">
        <div className="description-pane-meta">
          <span className="detail-oid">{detail.oid.slice(0, 7)}</span>
          <span className="detail-meta-sep">·</span>
          <span className="detail-date">{formatDateTime(detail.timestamp)}</span>
          <span className="detail-meta-sep">·</span>
          <span className="detail-author">{detail.author_name}</span>
        </div>
        <div className="description-pane-title">{detail.summary}</div>
      </div>

      {detail.body ? (
        <div className="description-pane-body">
          <div className="detail-commit-body">
            <Markdown>{detail.body}</Markdown>
          </div>
        </div>
      ) : (
        <div className="description-pane-empty">No description.</div>
      )}
    </div>
  );
}
