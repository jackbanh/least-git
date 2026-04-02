import { parseDiff, Diff, Hunk, Decoration, getChangeKey, useChangeSelect } from "react-diff-view";
import type { HunkData, ChangeData, GutterOptions } from "react-diff-view";
import "react-diff-view/style/index.css";
import "./DiffViewer.css";
import "./InteractiveDiffViewer.css";

interface Props {
  diff: string;
  /** true = viewing staged diff; false = viewing unstaged diff */
  staged: boolean;
  onApplyHunk: (patch: string) => void;
  onApplyLines: (patch: string) => void;
}

/** Rebuild a minimal unified diff string from a subset of changes in a hunk */
function buildHunkPatch(file: ReturnType<typeof parseDiff>[number], hunk: HunkData, changes?: ChangeData[]): string {
  const header = `--- a/${file.oldPath}\n+++ b/${file.newPath}\n`;

  let filteredChanges: ChangeData[];
  if (changes) {
    // For line-level: include selected inserts/deletes + all normal (context) lines
    filteredChanges = hunk.changes.filter(
      (c) => c.type === "normal" || changes.some((sel) => getChangeKey(sel) === getChangeKey(c))
    );
  } else {
    filteredChanges = hunk.changes;
  }

  const addCount = filteredChanges.filter((c) => c.type === "insert").length;
  const delCount = filteredChanges.filter((c) => c.type === "delete").length;
  const contextCount = filteredChanges.filter((c) => c.type === "normal").length;

  const hunkHeader = `@@ -${hunk.oldStart},${contextCount + delCount} +${hunk.newStart},${contextCount + addCount} @@\n`;
  const body = filteredChanges
    .map((c) => {
      if (c.type === "insert") return `+${c.content.slice(1)}\n`;
      if (c.type === "delete") return `-${c.content.slice(1)}\n`;
      return ` ${c.content.slice(1)}\n`;
    })
    .join("");

  return header + hunkHeader + body;
}

function HunkActions({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="idv-hunk-action" onClick={onClick}>
      {label}
    </button>
  );
}

export default function InteractiveDiffViewer({ diff, staged, onApplyHunk, onApplyLines }: Props) {
  if (!diff.trim()) return null;

  const files = parseDiff(diff);

  return (
    <div className="diff-scroll">
      {files.map((file) => (
        <FileView
          key={`${file.oldPath}:${file.newPath}`}
          file={file}
          staged={staged}
          onApplyHunk={onApplyHunk}
          onApplyLines={onApplyLines}
        />
      ))}
    </div>
  );
}

function FileView({
  file,
  staged,
  onApplyHunk,
  onApplyLines,
}: {
  file: ReturnType<typeof parseDiff>[number];
  staged: boolean;
  onApplyHunk: (patch: string) => void;
  onApplyLines: (patch: string) => void;
}) {
  const [selectedChanges, onChangeSelect] = useChangeSelect(file.hunks, { multiple: true });

  const hunkActionLabel = staged ? "Unstage hunk" : "Stage hunk";
  const lineActionLabel = staged ? "Unstage lines" : "Stage lines";

  function renderGutter({ change }: GutterOptions) {
    // Only show the per-line button on insert/delete lines when something is selected
    if (change.type === "normal" || selectedChanges.length === 0) return null;
    if (!selectedChanges.includes(getChangeKey(change))) return null;
    return null; // line buttons handled via the selection bar below
  }

  const selectedChangeObjects = file.hunks
    .flatMap((h) => h.changes)
    .filter((c) => selectedChanges.includes(getChangeKey(c)));

  // Find which hunk owns the first selected change (for line-level patch building)
  const hunkForSelection = file.hunks.find((h) =>
    h.changes.some((c) => selectedChanges.includes(getChangeKey(c)))
  );

  return (
    <>
      {selectedChanges.length > 0 && hunkForSelection && (
        <div className="idv-selection-bar">
          <span className="idv-selection-count">{selectedChanges.length} line{selectedChanges.length > 1 ? "s" : ""} selected</span>
          <button
            className="idv-action-btn"
            onClick={() => {
              onApplyLines(buildHunkPatch(file, hunkForSelection, selectedChangeObjects));
            }}
          >
            {lineActionLabel}
          </button>
        </div>
      )}
      <Diff
        viewType="unified"
        diffType={file.type}
        hunks={file.hunks}
        selectedChanges={selectedChanges}
        gutterEvents={{ onClick: onChangeSelect }}
        renderGutter={renderGutter}
        gutterType="default"
      >
        {(hunks) =>
          hunks.map((hunk) => (
            <>
              <Decoration key={`deco-${hunk.content}`}>
                <div className="idv-hunk-header">
                  <span className="idv-hunk-range">{hunk.content}</span>
                  <HunkActions
                    label={hunkActionLabel}
                    onClick={() => onApplyHunk(buildHunkPatch(file, hunk))}
                  />
                </div>
              </Decoration>
              <Hunk key={hunk.content} hunk={hunk} />
            </>
          ))
        }
      </Diff>
    </>
  );
}
