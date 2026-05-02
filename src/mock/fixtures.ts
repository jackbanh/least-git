// Mock fixture data for browser dev mode (no Tauri backend).
// Approximates a mid-size monorepo with realistic commit history.

export const MOCK_TAB_ID = "/mock/least-git";
export const MOCK_TAB_PATH = "/mock/least-git";
export const MOCK_TAB_NAME = "least-git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function oid(hex: string) {
  return hex.padEnd(40, "0");
}

function ts(daysAgo: number, hour = 10): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export const MOCK_BRANCHES = [
  { name: "main",                          is_head: true  },
  { name: "feature/interactive-diff",      is_head: false },
  { name: "feature/dark-mode-tweaks",      is_head: false },
  { name: "fix/virtual-list-scroll-reset", is_head: false },
  { name: "fix/branch-watcher-debounce",   is_head: false },
  { name: "chore/upgrade-gix-0.68",        is_head: false },
  { name: "chore/upgrade-tauri-2.11",      is_head: false },
  { name: "spike/file-tree-sidebar",       is_head: false },
  { name: "spike/commit-graph-dots",       is_head: false },
  { name: "docs/readme-screenshots",       is_head: false },
];

// ---------------------------------------------------------------------------
// Commits  (60 entries, newest first)
// ---------------------------------------------------------------------------

const RAW_COMMITS = [
  ["a1b2c3d4", "a1b2c3d", "feat: add interactive hunk staging to working tree",          "Jack Banh",      "jack@example.com",  0,  14],
  ["b2c3d4e5", "b2c3d4e", "fix: reset virtual list scroll position on tab switch",       "Jack Banh",      "jack@example.com",  1,  16],
  ["c3d4e5f6", "c3d4e5f", "refactor: extract useCommitSelection hook",                   "Jack Banh",      "jack@example.com",  2,  11],
  ["d4e5f6a7", "d4e5f6a", "chore: upgrade gix to 0.68.0",                               "Jack Banh",      "jack@example.com",  3,   9],
  ["e5f6a7b8", "e5f6a7b", "fix: debounce FSMonitor branch watcher (was firing 3×)",      "Jack Banh",      "jack@example.com",  4,  15],
  ["f6a7b8c9", "f6a7b8c", "feat: sage green chrome title bar follows accent hue",        "Jack Banh",      "jack@example.com",  5,  10],
  ["a7b8c9d0", "a7b8c9d", "fix: remove Mantine tab underline via list ::before",         "Jack Banh",      "jack@example.com",  5,  17],
  ["b8c9d0e1", "b8c9d0e", "feat: replace Open Repo button with + icon in tab bar",       "Jack Banh",      "jack@example.com",  6,  13],
  ["c9d0e1f2", "c9d0e1f", "chore: regenerate icons from revised 1024px source",          "Jack Banh",      "jack@example.com",  7,   9],
  ["d0e1f2a3", "d0e1f2a", "feat: add Hide / Hide Others / Show All to macOS menu",       "Jack Banh",      "jack@example.com",  8,  11],
  ["e1f2a3b4", "e1f2a3b", "fix: working tree detail crashes on empty diff response",     "Jack Banh",      "jack@example.com",  9,  14],
  ["f2a3b4c5", "f2a3b4c", "feat: diff viewer shows colored left-bar for add/remove",     "Jack Banh",      "jack@example.com", 10,  10],
  ["a3b4c5d6", "a3b4c5d", "perf: memoize branch list to avoid redundant re-renders",     "Jack Banh",      "jack@example.com", 11,  16],
  ["b4c5d6e7", "b4c5d6e", "feat: commit list shows amber dot for uncommitted changes",   "Jack Banh",      "jack@example.com", 12,   9],
  ["c5d6e7f8", "c5d6e7f", "refactor: split CommitDetail into file list + body panes",    "Jack Banh",      "jack@example.com", 13,  11],
  ["d6e7f8a9", "d6e7f8a", "fix: tab bar drag region blocks + button click on Windows",   "Jack Banh",      "jack@example.com", 14,  15],
  ["e7f8a9b0", "e7f8a9b", "chore: update npm deps (patch/minor only)",                   "Jack Banh",      "jack@example.com", 15,  10],
  ["f8a9b0c1", "f8a9b0c", "feat: resizable sidebar, commit list, and detail pane",       "Jack Banh",      "jack@example.com", 16,  14],
  ["a9b0c1d2", "a9b0c1d", "fix: gix open_repo leaks file handles on rapid tab switch",   "Jack Banh",      "jack@example.com", 17,   9],
  ["b0c1d2e3", "b0c1d2e", "feat: branch switcher fuzzy filter with keyboard nav",        "Jack Banh",      "jack@example.com", 18,  13],
  ["c1d2e3f4", "c1d2e3f", "chore: configure PostCSS with oklch polyfill",                "Jack Banh",      "jack@example.com", 19,  10],
  ["d2e3f4a5", "d2e3f4a", "feat: working tree shows staged/unstaged split",              "Jack Banh",      "jack@example.com", 20,  16],
  ["e3f4a5b6", "e3f4a5b", "fix: CommitList infinite scroll fires duplicate requests",    "Jack Banh",      "jack@example.com", 21,  11],
  ["f4a5b6c7", "f4a5b6c", "feat: add Tweaks panel (theme toggle + accent hue picker)",   "Jack Banh",      "jack@example.com", 22,   9],
  ["a5b6c7d8", "a5b6c7d", "refactor: migrate from libgit2 to gix backend",              "Jack Banh",      "jack@example.com", 23,  14],
  ["b6c7d8e9", "b6c7d8e", "fix: first-parent walk was including merge commits",          "Jack Banh",      "jack@example.com", 24,  10],
  ["c7d8e9f0", "c7d8e9f", "feat: virtualised commit list with @tanstack/react-virtual",  "Jack Banh",      "jack@example.com", 25,  15],
  ["d8e9f0a1", "d8e9f0a", "chore: add Rust clippy + ESLint to CI",                       "Jack Banh",      "jack@example.com", 26,   9],
  ["e9f0a1b2", "e9f0a1b", "feat: AppState uses DashMap for concurrent tab access",       "Jack Banh",      "jack@example.com", 27,  11],
  ["f0a1b2c3", "f0a1b2c", "feat: initial Tauri 2 + React + Rust scaffold",               "Jack Banh",      "jack@example.com", 28,  13],
] as const;

export const MOCK_COMMITS = RAW_COMMITS.map(
  ([full, short, summary, author_name, author_email, daysAgo, hour], index) => ({
    oid:          oid(full),
    short_oid:    short,
    summary,
    author_name,
    author_email,
    timestamp:    ts(daysAgo, hour),
    parent_oid:   index < RAW_COMMITS.length - 1 ? oid(RAW_COMMITS[index + 1][0]) : null,
  })
);

// ---------------------------------------------------------------------------
// Commit detail  (used for any selected commit)
// ---------------------------------------------------------------------------

export const MOCK_COMMIT_DETAIL = {
  oid:         oid("a1b2c3d4"),
  summary:     "feat: add interactive hunk staging to working tree",
  body:        "Implements per-hunk staging using a custom patch builder.\n\nThe user can click any hunk header to stage or unstage that hunk\nindividually. Patch is applied via `git apply --cached`.\n\nCloses #42.",
  author_name: "Jack Banh",
  author_email: "jack@example.com",
  timestamp:   ts(0, 14),
  files: [
    { path: "src/components/WorkingTreeDetail.tsx", status: "M" },
    { path: "src/components/InteractiveDiffViewer.tsx", status: "A" },
    { path: "src/components/InteractiveDiffViewer.css", status: "A" },
    { path: "src-tauri/src/lib.rs", status: "M" },
    { path: "src-tauri/src/diff.rs", status: "A" },
  ],
};

// ---------------------------------------------------------------------------
// File diff  (unified diff returned by get_file_diff / get_staged_diff etc.)
// ---------------------------------------------------------------------------

export const MOCK_DIFF = `\
diff --git a/src/components/DiffViewer.tsx b/src/components/DiffViewer.tsx
index a1b2c3d..b2c3d4e 100644
--- a/src/components/DiffViewer.tsx
+++ b/src/components/DiffViewer.tsx
@@ -1,7 +1,8 @@
-import { useMemo, useEffect, useRef } from "react";
-import { parseDiff, Diff, Hunk } from "react-diff-view";
+import { useMemo, useEffect, useRef, useState } from "react";
+import { parseDiff, Diff, Hunk, tokenize } from "react-diff-view";
+import type { HunkData, HunkTokens, RenderGutter } from "react-diff-view";
 import "react-diff-view/style/index.css";
 import "./DiffViewer.css";
-import { tokenizeSync } from "../lib/tokenize";
+import { tokenizeHunks } from "../lib/tokenize";
 import TokenizeWorker from "../workers/tokenize.worker?worker";

@@ -14,22 +15,40 @@ function getWorker(): Worker {
   return _worker;
 }

-// Simple LRU — evict oldest entry when full.
-const TOKEN_CACHE = new Map<string, HunkTokens>();
-const CACHE_MAX   = 50;
+// Module-level LRU cache (survives component remounts)
+const TOKEN_CACHE = new Map<string, HunkTokens>();
+const CACHE_MAX = 100;

 function cacheGet(key: string): HunkTokens | undefined {
   return TOKEN_CACHE.get(key);
 }

 function cacheSet(key: string, tokens: HunkTokens): void {
-  if (TOKEN_CACHE.size >= CACHE_MAX) TOKEN_CACHE.delete(TOKEN_CACHE.keys().next().value);
+  if (TOKEN_CACHE.size >= CACHE_MAX) {
+    TOKEN_CACHE.delete(TOKEN_CACHE.keys().next().value!);
+  }
   TOKEN_CACHE.set(key, tokens);
 }

+// Diffs with <= this many changed lines are tokenized synchronously to
+// avoid a brief flash of unhighlighted text on the first render.
+const SYNC_THRESHOLD = 50;
+
+const renderGutter: RenderGutter = ({ renderDefault }) =>
+  renderDefault() ?? null;
+
 export default function DiffViewer({ diff }: { diff: string }) {
   const files = useMemo(() => {
     if (!diff.trim()) return [];
-    return parseDiff(diff);
+    try { return parseDiff(diff); } catch { return []; }
   }, [diff]);

+  const [tokensMap, setTokensMap] = useState<Map<string, HunkTokens>>(new Map());
+
diff --git a/src/components/DiffViewer.css b/src/components/DiffViewer.css
index c3d4e5f..d4e5f6a 100644
--- a/src/components/DiffViewer.css
+++ b/src/components/DiffViewer.css
@@ -1,8 +1,19 @@
 .diff-scroll {
   flex: 1;
   min-height: 0;
   overflow-y: auto;
   overflow-x: auto;
-  font-size: 13px;
+  font-size: 12px;
 }

+/* Gutter (line numbers) */
+.diff-scroll .diff-gutter {
+  width: 3.5em;
+  min-width: 3.5em;
+  padding: 0 8px;
+  text-align: right;
+  color: var(--lg-ink-faint);
+  font-size: 11px;
+  user-select: none;
+  cursor: default;
+}
+
@@ -10,6 +21,7 @@ .diff-scroll .diff {
   min-width: max-content;
 }

+/* Override react-diff-view defaults */
 .diff-scroll .diff-code,
 .diff-scroll .diff-code pre,
 .diff-scroll .diff-code span {
diff --git a/src-tauri/src/lib.rs b/src-tauri/src/lib.rs
index e5f6a7b..f6a7b8c 100644
--- a/src-tauri/src/lib.rs
+++ b/src-tauri/src/lib.rs
@@ -1,6 +1,6 @@
 use std::collections::HashMap;
-use std::sync::Mutex;
+use std::sync::{Arc, Mutex};
 use tauri::Manager;

 // Performance-critical path — avoid allocations in the hot loop.
@@ -42,19 +42,18 @@ pub struct AppState {
 }

 impl AppState {
-    pub fn new() -> Self {
-        Self {
-            tabs: DashMap::new(),
-        }
+    pub fn new() -> Arc<Self> {
+        Arc::new(Self {
+            tabs: DashMap::new(),
+        })
     }

-    // Returns true if the tab was newly inserted.
-    pub fn open_tab(&self, id: String, path: PathBuf, name: String) -> bool {
+    /// Opens or re-opens a tab. Returns true if newly inserted.
+    pub fn open_tab(&self, id: String, path: PathBuf, name: String) -> bool {
         self.tabs
             .entry(id)
             .or_insert_with(|| RepoEntry { path, name })
             .is_new()
     }
-
 }

@@ -88,8 +87,10 @@ pub async fn get_working_tree_status(
     tab_id: String,
     state: tauri::State<'_, AppState>,
 ) -> Result<WorkingTreeStatus, String> {
+    // --no-optional-locks must be a top-level flag (before the subcommand)
     let output = git_async()
         .arg("--no-optional-locks")
+        .arg("-C")
+        .arg(&repo_path)
         .arg("status")
         .arg("--porcelain=v1")
-        .arg("-C")
-        .arg(&repo_path)
         .output()
         .await
         .map_err(|e| e.to_string())?;
`;

// ---------------------------------------------------------------------------
// Working tree status
// ---------------------------------------------------------------------------

export const MOCK_WORKING_TREE: {
  staged: { path: string; status: string; is_untracked: boolean }[];
  unstaged: { path: string; status: string; is_untracked: boolean }[];
} = {
  staged: [
    { path: "src/components/InteractiveDiffViewer.tsx", status: "A", is_untracked: false },
    { path: "src/components/InteractiveDiffViewer.css",  status: "A", is_untracked: false },
    { path: "src-tauri/src/diff.rs",                     status: "A", is_untracked: false },
  ],
  unstaged: [
    { path: "src/components/WorkingTreeDetail.tsx",       status: "M", is_untracked: false },
    { path: "src-tauri/src/lib.rs",                       status: "M", is_untracked: false },
  ],
};

// Returned by get_untracked_files (separate slow call).
export const MOCK_UNTRACKED_FILES: string[] = [
  "src/mock/fixtures.ts",
  "notes/scratch.md",
];
