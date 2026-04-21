import { tokenizeHunks } from "../lib/tokenize";
import type { HunkData } from "react-diff-view";

self.onmessage = (e: MessageEvent) => {
  const { id, key, cacheKey, hunks, language } = e.data as {
    id: number;
    key: string;
    cacheKey: string;
    hunks: HunkData[];
    language: string;
  };
  try {
    const tokens = tokenizeHunks(hunks, language);
    self.postMessage({ id, key, cacheKey, tokens });
  } catch {
    // Unknown language or tokenize failure — caller shows plain text.
    self.postMessage({ id, key, cacheKey, tokens: null });
  }
};
