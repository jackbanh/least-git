import { useEffect, useRef, useState } from "react";
import { parseDiff } from "react-diff-view";
import type { HunkData, HunkTokens } from "react-diff-view";
import TokenizeWorker from "../workers/tokenize.worker?worker";
import { tokenizeHunks, detectLanguage, fileCacheKey, SYNC_THRESHOLD } from "./tokenize";

let _worker: Worker | null = null;
function getWorker(): Worker {
  if (!_worker) _worker = new TokenizeWorker();
  return _worker;
}

const TOKEN_CACHE = new Map<string, HunkTokens>();
const CACHE_MAX = 100;

function cachePut(key: string, tokens: HunkTokens) {
  if (TOKEN_CACHE.size >= CACHE_MAX) TOKEN_CACHE.delete(TOKEN_CACHE.keys().next().value!);
  TOKEN_CACHE.set(key, tokens);
}

/**
 * Tokenizes parsed diff files for syntax highlighting.
 * Returns a Map from render key (`oldPath:newPath`) to HunkTokens.
 * Small diffs are tokenized synchronously; large ones use a shared worker.
 */
export function useTokens(
  files: ReturnType<typeof parseDiff>,
): Map<string, HunkTokens> {
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
          cachePut(cacheKey, tokens);
          initial.set(renderKey, tokens);
        } catch { /* unknown language — render plain */ }
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
        cachePut(cacheKey, tokens);
        setTokensMap((prev) => new Map(prev).set(key, tokens));
      }
    }

    const worker = getWorker();
    worker.addEventListener("message", handleMessage);
    return () => worker.removeEventListener("message", handleMessage);
  }, [files]);

  return tokensMap;
}
