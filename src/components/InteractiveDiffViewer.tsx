import { useMemo, useEffect, useRef, useState } from "react";
import { parseDiff, Diff, Hunk, Decoration, getChangeKey, useChangeSelect } from "react-diff-view";
import type { HunkData, HunkTokens, ChangeData, GutterOptions } from "react-diff-view";
import "react-diff-view/style/index.css";
import "./DiffViewer.css";
import "./InteractiveDiffViewer.css";
import { tokenizeHunks } from "../lib/tokenize";
import TokenizeWorker from "../workers/tokenize.worker?worker";

let _idvWorker: Worker | null = null;
function getWorker(): Worker {
  if (!_idvWorker) _idvWorker = new TokenizeWorker();
  return _idvWorker;
}

const TOKEN_CACHE = new Map<string, HunkTokens>();
const CACHE_MAX = 50;

const EXT_LANG: Record<string, string> = {
  js: "jsx", mjs: "jsx", cjs: "jsx",
  jsx: "jsx",
  ts: "tsx", mts: "tsx", cts: "tsx",
  tsx: "tsx",
  rs: "rust",
  py: "python", pyi: "python",
  go: "go",
  java: "java",
  css: "css", scss: "css",
  json: "json", jsonc: "json",
  yaml: "yaml", yml: "yaml",
  sh: "bash", bash: "bash",
  md: "markdown", mdx: "markdown",
  toml: "toml",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  swift: "swift",
  kt: "kotlin", kts: "kotlin",
};

function detectLanguage(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? null;
}

function fileCacheKey(file: ReturnType<typeof parseDiff>[number]): string {
  if (file.oldRevision && file.newRevision) {
    return `${file.oldRevision}:${file.newRevision}:${file.newPath}`;
  }
  return `${file.oldPath}:${file.newPath}:${file.hunks.map((h) => h.content).join("|")}`;
}

const SYNC_THRESHOLD = 50;

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
  const files = useMemo(() => {
    if (!diff.trim()) return [];
    try { return parseDiff(diff); } catch { return []; }
  }, [diff]);

  const [tokensMap, setTokensMap] = useState<Map<string, HunkTokens>>(new Map());
  const pendingRef = useRef<Set<number>>(new Set());
  const reqIdRef = useRef(0);

  useEffect(() => {
    pendingRef.current.clear();
    const initial = new Map<string, HunkTokens>();
    let hasAsync = false;

    for (const file of files) {
      const filePath = file.newPath !== "/dev/null" ? file.newPath : file.oldPath;
      const language = detectLanguage(filePath ?? "");
      if (!language) continue;

      const renderKey = `${file.oldPath}:${file.newPath}`;
      const cacheKey = fileCacheKey(file);

      const cached = TOKEN_CACHE.get(cacheKey);
      if (cached) { initial.set(renderKey, cached); continue; }

      const lineCount = file.hunks.reduce((n, h) => n + h.changes.length, 0);

      if (lineCount <= SYNC_THRESHOLD) {
        try {
          const tokens = tokenizeHunks(file.hunks as HunkData[], language);
          if (TOKEN_CACHE.size >= CACHE_MAX) TOKEN_CACHE.delete(TOKEN_CACHE.keys().next().value!);
          TOKEN_CACHE.set(cacheKey, tokens);
          initial.set(renderKey, tokens);
        } catch { /* unknown language */ }
      } else {
        const id = ++reqIdRef.current;
        pendingRef.current.add(id);
        hasAsync = true;
        getWorker().postMessage({ id, key: renderKey, cacheKey, hunks: file.hunks, language });
      }
    }

    setTokensMap(initial);
    if (!hasAsync) return;

    function handleMessage(e: MessageEvent) {
      const { id, key, cacheKey, tokens } = e.data as {
        id: number; key: string; cacheKey: string; tokens: HunkTokens | null;
      };
      if (!pendingRef.current.has(id)) return;
      pendingRef.current.delete(id);
      if (tokens) {
        if (TOKEN_CACHE.size >= CACHE_MAX) TOKEN_CACHE.delete(TOKEN_CACHE.keys().next().value!);
        TOKEN_CACHE.set(cacheKey, tokens);
        setTokensMap((prev) => new Map(prev).set(key, tokens));
      }
    }

    const worker = getWorker();
    worker.addEventListener("message", handleMessage);
    return () => worker.removeEventListener("message", handleMessage);
  }, [files]);

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
