import { useEffect, useMemo, useState } from "react";
import { IconChevronRight, IconFolder } from "@tabler/icons-react";
import "./FileTree.css";

export interface FileTreeEntry {
  path: string;
  status: string;
}

interface TreeNode {
  name: string;
  path: string;
  children: Record<string, TreeNode>;
  files: FileTreeEntry[];
  sortedChildren: TreeNode[];
  sortedFiles: FileTreeEntry[];
}

function buildTree(files: FileTreeEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: {}, files: [], sortedChildren: [], sortedFiles: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.children[seg]) {
        node.children[seg] = {
          name: seg, path: parts.slice(0, i + 1).join("/"),
          children: {}, files: [], sortedChildren: [], sortedFiles: [],
        };
      }
      node = node.children[seg];
    }
    node.files.push(f);
  }

  function walk(n: TreeNode) {
    n.sortedChildren = Object.values(n.children).sort((a, b) => a.name.localeCompare(b.name));
    n.sortedFiles = [...n.files].sort((a, b) =>
      (a.path.split("/").pop() ?? "").localeCompare(b.path.split("/").pop() ?? "")
    );
    n.sortedChildren.forEach(walk);
  }
  walk(root);

  // Collapse linear chains: if a folder has exactly 1 subfolder and 0 files,
  // fuse names (e.g. "src" → "components" → "foo.ts" becomes "src/components").
  function collapse(n: TreeNode) {
    while (n.sortedChildren.length === 1 && n.sortedFiles.length === 0 && n !== root) {
      const child = n.sortedChildren[0];
      n.name = n.name + "/" + child.name;
      n.path = child.path;
      n.children = child.children;
      n.files = child.files;
      n.sortedChildren = child.sortedChildren;
      n.sortedFiles = child.sortedFiles;
    }
    n.sortedChildren.forEach(collapse);
  }
  collapse(root);

  return root;
}

function collectFolderPaths(node: TreeNode, out: Set<string> = new Set()): Set<string> {
  if (node.path) out.add(node.path);
  node.sortedChildren.forEach(c => collectFolderPaths(c, out));
  return out;
}

// Returns file paths in the order they appear in the rendered tree (depth-first).
// Used by parent components for keyboard navigation.
export function flattenTree(files: FileTreeEntry[]): string[] {
  const tree = buildTree(files);
  const result: string[] = [];
  function walk(n: TreeNode) {
    n.sortedChildren.forEach(walk);
    n.sortedFiles.forEach(f => result.push(f.path));
  }
  walk(tree);
  return result;
}

export function FileTree({
  files,
  selected,
  onSelect,
  onContextMenu,
}: {
  files: FileTreeEntry[];
  selected: string | null;
  onSelect: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => collectFolderPaths(tree));

  // Expand any folders that appear in newly arrived files (e.g. untracked arriving later).
  useEffect(() => {
    const allPaths = collectFolderPaths(tree);
    setExpanded(prev => {
      let changed = false;
      allPaths.forEach(p => { if (!prev.has(p)) changed = true; });
      if (!changed) return prev;
      return new Set([...prev, ...allPaths]);
    });
  }, [tree]);

  const toggle = (path: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });

  return (
    <div className="file-tree">
      <TreeFolder
        node={tree}
        depth={0}
        expanded={expanded}
        onToggle={toggle}
        selected={selected}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        hideRoot
      />
    </div>
  );
}

function TreeFolder({
  node, depth, expanded, onToggle, selected, onSelect, onContextMenu, hideRoot,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selected: string | null;
  onSelect: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, path: string) => void;
  hideRoot?: boolean;
}) {
  const isOpen = hideRoot || expanded.has(node.path);
  return (
    <div>
      {!hideRoot && (
        <div
          className="file-tree-folder"
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onToggle(node.path)}
        >
          <span className={`file-tree-caret${isOpen ? " file-tree-caret--open" : ""}`}>
            <IconChevronRight size={11} strokeWidth={1.75} />
          </span>
          <IconFolder size={12} strokeWidth={1.5} className="file-tree-folder-icon" />
          <span className="file-tree-folder-name">{node.name}</span>
        </div>
      )}
      {isOpen && (
        <div
          className={hideRoot ? undefined : "file-tree-level"}
          style={hideRoot ? undefined : { "--tree-guide-x": `${10 + depth * 14 + 6}px` } as React.CSSProperties}
        >
          {node.sortedChildren.map(c => (
            <TreeFolder
              key={c.path}
              node={c}
              depth={hideRoot ? depth : depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selected={selected}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
          {node.sortedFiles.map(f => (
            <TreeFileRow
              key={f.path}
              file={f}
              depth={hideRoot ? depth : depth + 1}
              selected={selected === f.path}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeFileRow({
  file, depth, selected, onSelect, onContextMenu,
}: {
  file: FileTreeEntry;
  depth: number;
  selected: boolean;
  onSelect: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, path: string) => void;
}) {
  const name = file.path.split("/").pop()!;
  return (
    <div
      className={`file-tree-file${selected ? " file-tree-file--selected" : ""}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={(e) => {
        (e.currentTarget.closest(".detail-files") as HTMLElement | null)?.focus();
        onSelect(file.path);
      }}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, file.path) : undefined}
    >
      <span className={`file-status file-status--${file.status.toLowerCase()}`}>
        {file.status}
      </span>
      <span className="file-tree-filename" title={file.path}>{name}</span>
    </div>
  );
}
