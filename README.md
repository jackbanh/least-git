**Project: least-git** — a Git GUI client intentionally limited to 5 core operations (view history, switch branches, commit, pull, push), purpose-built for performance on large monorepos with 100k+ commits, thousands of files, and many branches/remotes.

**Platforms:** macOS and Windows (both testable; code signing scoped to macOS only, not a current priority)

**Stack:**
- **Tauri 2** (native shell, ~50ms startup, no Chromium overhead)
- **React + TypeScript** (UI layer — thin renderer only)
- **Rust + async Tokio** (all Git logic and state)
- **gitoxide** (pure Rust Git library — parallel pack reads, lazy streaming object access, better than libgit2 for this use case)
- **System git binary** (shelled out for push/pull/checkout only — no reimplementing SSH/HTTPS transport for MVP)
- **Mantine v8** — UI components for app chrome only (tabs, toolbar, dialogs, forms)
- **Zustand** — tab state
- **@tanstack/react-virtual** — virtualised lists
- **tauri-plugin-log** — structured logging; stdout + log file in dev, log file only in release

**Architecture:**
- `AppState` is `DashMap<String, RepoEntry>` (tab id → repo path + name + detail cache), managed by Tauri
- Tab id is the canonicalised repo path
- Repos are opened fresh per command call (`gix::open`) — no cached `Repository` handle
- Commit metadata is cached in `RepoEntry.detail_cache: Mutex<HashMap<String, CommitDetailData>>` — cleared on refresh
- IPC pattern: frontend calls `invoke()`, Rust returns data or emits streaming events via `tauri::emit`
- Commit graph loaded in paginated chunks (25 at a time) via `gix::revision::Walk` — never full DAG in memory
- UI uses virtualised lists (`@tanstack/react-virtual`) for history and file tree — ~30 DOM rows max at any time
- Native menu (Repository > Refresh, Repository > Branch…) emits `menu:refresh` / `menu:branch` Tauri events

**UI design:**
- Follows a subset of Sourcetree's layout and conventions — familiar to existing Sourcetree users but stripped to only the 5 core operations
- Remote branches are not shown anywhere in the UI — local branches only
- **Styling: Mantine v8** for app chrome (tabs, toolbar, branch panel, dialogs, commit form) — v7+ uses CSS modules internally, no runtime CSS-in-JS overhead
- Virtualised list rows (commit history, file tree) use plain CSS classes only — no Mantine components inside rows, as prop overhead compounds across high-frequency mount/unmount cycles during scroll
- **State management: Zustand** — one store slice per open repo tab, avoids prop-drilling across the tab/panel hierarchy

**Rules for Rust commands:**

- **All external process calls must be async.** Every invocation of the system `git` binary must use `git_async()` (returns `tokio::process::Command`) and `.await` the result. Using the synchronous `git()` helper inside a `#[tauri::command]` blocks a Tokio worker thread for the entire duration of the process — seconds for checkout or pull on large repos.

  ```rust
  // WRONG — blocks the async executor
  let out = git().args([...]).output()?;

  // CORRECT
  let out = git_async().args([...]).output().await?;
  ```

  `git()` (sync, `std::process::Command`) exists solely to define the two factory functions and must not be called from any Tauri command.

- **Long-running operations must stream output.** Operations that can take more than ~200ms (checkout, pull, push, rebase) must stream stdout/stderr line-by-line to the frontend via Tauri events rather than buffering and returning on completion. Use the `PullLine` / `PullDone` structs and the `GitOutputDrawer` frontend component. Event naming convention: `<operation>:line` and `<operation>:done`.

**Key performance constraints to design around:**
- History view must render recent commits on the current branch with no perceptible delay — first page of results must appear near-instantly even in repos with 100k+ total commits; virtual scroll handles the rest
- Branch switcher must feel instant for local branches — listing and switching must not block the UI; checkout should stream progress back rather than freezing until done
- Branch panel needs fuzzy search filter (thousands of branches) — filter runs client-side on already-loaded branch list, no round-trip per keystroke
- File tree must also be virtualised
- `git status` calls use Git's built-in FSMonitor daemon — latest Git version is required, no fallback for older versions

**Assumptions:**
- Git credentials are pre-configured in the system; push/pull may hang if they are not (acceptable for MVP)
- Minimum Git version: latest stable release (FSMonitor, `--pathspec-from-file`, and other modern features assumed available)

**Scope limits (do not add without discussion):**
- Remote branches are not shown anywhere — local branches only
- No tab persistence across restarts (deferred)
- No credential UI — assume creds pre-configured in system git
- No diff view beyond what's needed for the commit panel

**Validated decisions:**
- Name is **least-git** — no conflicts with existing git clients, intentional minimalism is the brand
- No existing free GUI client solves this — lazygit, GitButler, Sourcetree all have documented performance failures at this repo scale
- gitoxide over libgit2 for the Git backend; system git for network ops
- UI modelled on Sourcetree's layout — familiar baseline, not a blank-slate design
- Remote branches explicitly out of scope — reduces branch state complexity significantly
- Mantine Menu allowed inside virtualised list only with `overflowY: hidden` on the container while open (prevents scroll during menu interaction)

## Frontend structure

- `src/store.ts` — Zustand store: `tabs`, `activeTabId`, `openTab`, `closeTab`, `setActiveTab`, `bumpListKey`, `selectCommit`, `sidebarWidth`, `detailHeight`
- `src/App.tsx` — tabbed shell, Open Folder dialog, native menu event listeners
- `src/components/CommitList.tsx` — virtualised commit history (plain CSS rows, no Mantine inside); stale-while-revalidate via `staleCommitsRef`; context menu (Copy SHA-1, Pull with Rebase, Rebase Interactively, Reset to Here)
- `src/components/BranchSwitcher.tsx` — branch list with fuzzy filter; stale-while-revalidate; delegates checkout to `GitOutputDrawer`
- `src/components/BranchDialog.tsx` — modal dialog (Repository > Branch…); tabs for New Branch and Delete Branch
- `src/components/CommitDetail.tsx` — routing shell (uncommitted → `WorkingTreeDetail`, commit → `CommitDetailInner`); resizable file list + diff pane
- `src/components/WorkingTreeDetail.tsx` — staged/unstaged file list with interactive staging via `InteractiveDiffViewer`
- `src/components/DiffViewer.tsx` — read-only unified diff display
- `src/components/InteractiveDiffViewer.tsx` — hunk/line-level staging using `react-diff-view`
- `src/components/GitOutputDrawer.tsx` — generic streaming output drawer parameterised by `command`, `commandArgs`, `eventPrefix`; used by checkout and pull
- `src/components/PullDrawer.tsx` — thin wrapper around `GitOutputDrawer` for pull with rebase
- `src/components/ProgressBar.tsx` — thin loading bar shown during fetches
- Mantine CSS imported once in `src/main.tsx`

## Rust commands (`src-tauri/src/lib.rs`)

- `open_repo(path)` → `TabInfo` — canonicalises path, validates git repo, registers in AppState
- `close_tab(tab_id)` — removes from AppState
- `clear_detail_cache(tab_id)` — clears the commit metadata cache for a tab (called on refresh)
- `load_commits(tab_id, offset, limit)` → `Vec<CommitInfo>` — first-parent walk via gix, paginated by offset (page size: 25)
- `list_branches(tab_id)` → `Vec<BranchInfo>` — local branches only; main/master sorted first, rest alphabetical
- `create_branch(tab_id, name)` — runs `git checkout -b <name>` (creates and switches)
- `checkout_branch(tab_id, branch)` — streams progress via `checkout:line` / `checkout:done`
- `get_commit_detail(tab_id, oid)` → `CommitDetailData` — commit metadata + changed file list; results cached in AppState
- `get_file_diff(tab_id, oid, file_path)` → `String` — unified diff for a single file in a commit
- `get_working_tree_status(tab_id)` → staged + unstaged file lists
- `get_staged_diff(tab_id, file_path)` → `String` — diff of staged changes for a file
- `get_unstaged_diff(tab_id, file_path)` → `String` — diff of unstaged changes for a file
- `apply_patch(tab_id, patch, reverse)` — applies a partial patch for interactive staging/unstaging
- `pull_with_rebase(tab_id)` — auto-detects origin/main or origin/master; streams via `pull:line` / `pull:done`
