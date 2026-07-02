import { Menu } from "@mantine/core";
import { ContextMenuState } from "../hooks/useContextMenu";

export function FilePathDisplay({ path }: { path: string }) {
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

export function FileRow({
  path,
  status,
  isSelected,
  onClick,
  onContextMenu,
}: {
  path: string;
  status: string;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`file-row${isSelected ? " file-row--selected" : ""}`}
      onClick={(e) => {
        // Focus the nearest scrollable file-list container (keydown nav lives there).
        // Works for both CommitDetail (.detail-files) and WorkingTree (.detail-files-panes).
        (e.currentTarget.closest("[tabindex]") as HTMLElement | null)?.focus();
        onClick();
      }}
      onContextMenu={onContextMenu}
    >
      <span className={`file-status file-status--${status.toLowerCase()}`}>
        {status}
      </span>
      <span className="file-path" title={path}>
        <FilePathDisplay path={path} />
      </span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AnchoredMenuTarget({ contextMenu }: { contextMenu: ContextMenuState<any> | null }) {
  return (
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
  );
}
