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
diff --git a/src-tauri/src/lib.rs b/src-tauri/src/lib.rs
index a1b2c3d..b2c3d4e 100644
--- a/src-tauri/src/lib.rs
+++ b/src-tauri/src/lib.rs
@@ -58,12 +58,47 @@ pub fn get_working_tree_status(
     Ok(status)
 }

+#[tauri::command]
+pub fn apply_patch(
+    tab_id: String,
+    patch: String,
+    reverse: bool,
+    state: tauri::State<AppState>,
+) -> Result<(), String> {
+    let entry = state
+        .get(&tab_id)
+        .ok_or_else(|| format!("tab not found: {tab_id}"))?;
+    let repo_path = entry.path.clone();
+    drop(entry);
+
+    let mut cmd = std::process::Command::new("git");
+    cmd.current_dir(&repo_path)
+        .args(["apply", "--cached"])
+        .stdin(std::process::Stdio::piped());
+
+    if reverse {
+        cmd.arg("--reverse");
+    }
+
+    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
+    if let Some(stdin) = child.stdin.take() {
+        use std::io::Write;
+        let mut stdin = stdin;
+        stdin.write_all(patch.as_bytes()).map_err(|e| e.to_string())?;
+    }
+    let status = child.wait().map_err(|e| e.to_string())?;
+    if !status.success() {
+        return Err(format!("git apply exited with {status}"));
+    }
+    Ok(())
+}
+
 #[tauri::command]
 pub fn load_commits(
     tab_id: String,
@@ -71,6 +106,7 @@ pub fn load_commits(
     limit: usize,
     state: tauri::State<AppState>,
 ) -> Result<Vec<CommitInfo>, String> {
+    let _span = tracing::info_span!("load_commits").entered();
     let entry = state
         .get(&tab_id)
         .ok_or_else(|| format!("tab not found: {tab_id}"))?;
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
    { path: "src/mock/fixtures.ts",                       status: "A", is_untracked: true  },
  ],
};
