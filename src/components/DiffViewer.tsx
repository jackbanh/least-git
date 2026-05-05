import { useMemo } from "react";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import type { RenderGutter } from "react-diff-view";
import "react-diff-view/style/index.css";
import "./DiffViewer.css";
import { useTokens } from "../lib/useTokens";

const renderGutter: RenderGutter = ({ renderDefault }) => renderDefault() ?? null;

export default function DiffViewer({ diff }: { diff: string }) {
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
          <Diff
            key={key}
            viewType="unified"
            diffType={file.type}
            hunks={file.hunks}
            tokens={tokensMap.get(key) ?? null}
            renderGutter={renderGutter}
          >
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        );
      })}
    </div>
  );
}
