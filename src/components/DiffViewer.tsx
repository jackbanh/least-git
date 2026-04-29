import { useMemo, useEffect, useRef, useState } from "react";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import type { HunkData, HunkTokens, RenderGutter } from "react-diff-view";
import "react-diff-view/style/index.css";
import "./DiffViewer.css";
import { tokenizeHunks } from "../lib/tokenize";
import TokenizeWorker from "../workers/tokenize.worker?worker";

// ── Worker singleton ───────────────────────────────────────────────
let _worker: Worker | null = null;
function getWorker(): Worker {
  if (!_worker) _worker = new TokenizeWorker();
  return _worker;
}

// ── Module-level LRU cache (survives component remounts) ───────────
const TOKEN_CACHE = new Map<string, HunkTokens>();
const CACHE_MAX = 100;

function cacheGet(key: string): HunkTokens | undefined {
  return TOKEN_CACHE.get(key);
}

function cacheSet(key: string, tokens: HunkTokens): void {
  if (TOKEN_CACHE.size >= CACHE_MAX) {
    TOKEN_CACHE.delete(TOKEN_CACHE.keys().next().value!);
  }
  TOKEN_CACHE.set(key, tokens);
}

// ── Helpers ────────────────────────────────────────────────────────
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

function countLines(hunks: HunkData[]): number {
  return hunks.reduce((n, h) => n + h.changes.length, 0);
}

// Diffs with ≤ this many changed lines are tokenized synchronously to
// avoid a brief flash of unhighlighted text on the first render.
const SYNC_THRESHOLD = 50;

// ── Gutter renderer ───────────────────────────────────────────────
const renderGutter: RenderGutter = ({ renderDefault }) => renderDefault() ?? null;

// ── Component ──────────────────────────────────────────────────────
export default function DiffViewer({ diff }: { diff: string }) {
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

      // Cache hit — use immediately, no work needed.
      const cached = cacheGet(cacheKey);
      if (cached) {
        initial.set(renderKey, cached);
        continue;
      }

      const lineCount = countLines(file.hunks as HunkData[]);

      if (lineCount <= SYNC_THRESHOLD) {
        // Small diff: tokenize on the main thread so the first render is
        // already highlighted (no visible flash).
        try {
          const tokens = tokenizeHunks(file.hunks as HunkData[], language);
          cacheSet(cacheKey, tokens);
          initial.set(renderKey, tokens);
        } catch { /* unknown language — render plain */ }
      } else {
        // Large diff: offload to worker, show plain text until it responds.
        const id = ++reqIdRef.current;
        pendingRef.current.add(id);
        hasAsync = true;
        getWorker().postMessage({
          id, key: renderKey, cacheKey,
          hunks: file.hunks, language,
        });
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
        cacheSet(cacheKey, tokens);
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
