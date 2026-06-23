import { useMemo } from "react";
import type { ReactNode } from "react";
import refractor from "refractor/core";
// Importing from tokenize also registers all refractor languages as a side-effect.
import { detectLanguage } from "../lib/tokenize";
import "./FilePreview.css";

export interface FilePreviewData {
  content: string;
  is_binary: boolean;
  truncated: boolean;
}

// Above this many characters we skip highlighting and render plain text — large
// files in a monorepo must not block the UI on a synchronous refractor pass.
const HIGHLIGHT_MAX = 100_000;

type HastNode =
  | { type: "text"; value: string }
  | { type: "element"; tagName: string; properties?: { className?: string[] }; children: HastNode[] };

function renderHast(nodes: HastNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}.${i}`;
    if (node.type === "text") return node.value;
    const className = node.properties?.className?.join(" ");
    return (
      <span key={key} className={className}>
        {renderHast(node.children, key)}
      </span>
    );
  });
}

/**
 * Syntax-highlighted preview of an untracked (new) file's contents. New files
 * have no diff, so we show the file itself instead of an all-additions diff.
 */
export default function FilePreview({ path, preview }: { path: string; preview: FilePreviewData }) {
  const language = detectLanguage(path);

  const highlighted = useMemo<ReactNode[] | null>(() => {
    if (preview.is_binary || !preview.content) return null;
    if (!language || preview.content.length > HIGHLIGHT_MAX) return null;
    try {
      return renderHast(refractor.highlight(preview.content, language) as HastNode[], "h");
    } catch {
      return null; // unknown grammar — fall back to plain text
    }
  }, [preview.content, preview.is_binary, language]);

  if (preview.is_binary) {
    return (
      <div className="fp-empty">
        <span className="fp-empty-text">Binary file — no preview</span>
      </div>
    );
  }

  if (!preview.content) {
    return (
      <div className="fp-empty">
        <span className="fp-empty-text">Empty file</span>
      </div>
    );
  }

  const lineCount = preview.content.split("\n").length;

  return (
    <div className="fp-scroll">
      <div className="fp-table">
        <div className="fp-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i} className="fp-line-no">{i + 1}</span>
          ))}
        </div>
        <pre className="fp-code"><code>{highlighted ?? preview.content}</code></pre>
      </div>
      {preview.truncated && (
        <div className="fp-truncated">Preview truncated — file is larger than 512&nbsp;KB</div>
      )}
    </div>
  );
}
