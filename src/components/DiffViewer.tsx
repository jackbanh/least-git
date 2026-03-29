import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import "./DiffViewer.css";

type DiffLineKind = "header" | "hunk" | "add" | "remove" | "context";

function getDiffLineKind(line: string): DiffLineKind {
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("rename") ||
    line.startsWith("similarity") ||
    line.startsWith("Binary")
  )
    return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

export default function DiffViewer({ diff }: { diff: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const lines = diff.split("\n");

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className="diff-scroll">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const line = lines[vItem.index];
          const kind = getDiffLineKind(line);
          return (
            <div
              key={vItem.key}
              className={`diff-line diff-line--${kind}`}
              style={{
                position: "absolute",
                top: vItem.start,
                left: 0,
                right: 0,
                height: vItem.size,
              }}
            >
              {line || "\u00a0"}
            </div>
          );
        })}
      </div>
    </div>
  );
}
