import { parseDiff, Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";
import "./DiffViewer.css";

export default function DiffViewer({ diff }: { diff: string }) {
  if (!diff.trim()) return null;

  const files = parseDiff(diff);

  return (
    <div className="diff-scroll">
      {files.map((file) => (
        <Diff
          key={`${file.oldPath}:${file.newPath}`}
          viewType="unified"
          diffType={file.type}
          hunks={file.hunks}
          gutterType="none"
        >
          {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
      ))}
    </div>
  );
}
