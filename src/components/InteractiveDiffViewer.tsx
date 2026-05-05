import { useMemo } from "react";
import { parseDiff, Diff, Hunk, Decoration, getChangeKey, useChangeSelect } from "react-diff-view";
import type { HunkData, HunkTokens, ChangeData, GutterOptions } from "react-diff-view";
import "react-diff-view/style/index.css";
import "./DiffViewer.css";
import "./InteractiveDiffViewer.css";
import { useTokens } from "../lib/useTokens";

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

export default function InteractiveDiffViewer({ diff, staged, onApplyHunk, onApplyLines }: Props) {
  const files = useMemo(() => {
    if (!diff.trim()) return [];
    try { return parseDiff(diff); } catch { return []; }
  }, [diff]);

  const tokensMap = useTokens(files);

  if (files.length === 0) return null;

  return (
    <div className="diff-scroll">
      {files.map((file) => {
        const key = `${file.oldPath}:${file.newPath}`;
        return (
          <FileView
            key={key}
            file={file}
            tokens={tokensMap.get(key) ?? null}
            staged={staged}
            onApplyHunk={onApplyHunk}
            onApplyLines={onApplyLines}
          />
        );
      })}
    </div>
  );
}

function FileView({
  file,
  tokens,
  staged,
  onApplyHunk,
  onApplyLines,
}: {
  file: ReturnType<typeof parseDiff>[number];
  tokens: HunkTokens | null;
  staged: boolean;
  onApplyHunk: (patch: string) => void;
  onApplyLines: (patch: string) => void;
}) {
  const [selectedChanges, onChangeSelect] = useChangeSelect(file.hunks, { multiple: true });

  const hunkActionLabel = staged ? "Unstage hunk" : "Stage hunk";
  const lineActionLabel = staged ? "Unstage lines" : "Stage lines";

  function renderGutter({ change }: GutterOptions) {
    if (change.type === "normal" || selectedChanges.length === 0) return null;
    if (!selectedChanges.includes(getChangeKey(change))) return null;
    return null;
  }

  const selectedChangeObjects = file.hunks
    .flatMap((h) => h.changes)
    .filter((c) => selectedChanges.includes(getChangeKey(c)));

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
        tokens={tokens ?? undefined}
        selectedChanges={selectedChanges}
        gutterEvents={{ onClick: onChangeSelect }}
        renderGutter={renderGutter}
        gutterType="none"
      >
        {(hunks) =>
          hunks.map((hunk) => (
            <>
              <Decoration key={`deco-${hunk.content}`}>
                <div className="idv-hunk-header">
                  <span className="idv-hunk-range">{hunk.content}</span>
                  <button
                    className="idv-hunk-action"
                    onClick={() => onApplyHunk(buildHunkPatch(file, hunk))}
                  >
                    {hunkActionLabel}
                  </button>
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
