import { useTabStore } from "../store";
import { useResize } from "../hooks/useResize";

/**
 * Shared outer shell for CommitDetail and WorkingTreeDetail.
 *
 * Owns the left-panel width (persisted in the store), the vertical resize
 * handle between the left panel and the diff panel, and the three-column
 * CSS structure. Callers provide the panel contents via `left` and `diff`
 * slot props. An optional `overlay` slot is available for fixed-position
 * elements like context menus that need to be rendered inside the root div
 * without affecting layout.
 */
export default function DetailLayout({
  left,
  diff,
  overlay,
}: {
  left: React.ReactNode;
  diff: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const detailLeftWidth = useTabStore((s) => s.detailLeftWidth);
  const setDetailLeftWidth = useTabStore((s) => s.setDetailLeftWidth);
  const startLeftResize = useResize(detailLeftWidth, setDetailLeftWidth, "horizontal", 140, 9999);

  return (
    <div className="commit-detail">
      <div className="detail-left" style={{ width: detailLeftWidth }}>
        {left}
      </div>
      {overlay}
      <div className="resize-handle resize-handle--vertical" onMouseDown={startLeftResize} />
      <div className="detail-diff">
        {diff}
      </div>
    </div>
  );
}
