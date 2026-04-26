# least-git

Minimal Git GUI (5 operations only: history, branch switch, commit, pull, push) built for large monorepos.

## Stack

- **Tauri 2** — native shell, no Chromium
- **React + TypeScript + Vite** — UI in `src/`
- **Rust + Tokio** — all Git logic in `src-tauri/src/`
- **gix** — Git backend (not libgit2)
- **System git binary** — push/pull only (no reimplementing transport)
- **Mantine v7** — UI components for app chrome only
- **Zustand** — tab state
- **@tanstack/react-virtual** — virtualised lists

## Architecture

- `AppState` is `DashMap<String, RepoEntry>` (tab id → repo path + name), managed by Tauri
- Tab id is the canonicalised repo path
- Repos are opened fresh per command call (`gix::open`) — no cached `Repository` handle
- IPC pattern: frontend calls `invoke()`, Rust returns data or emits streaming events via `tauri::emit`

## Critical perf rules

- **Never use Mantine components inside virtualised list rows** — `CommitList` rows are plain divs with CSS classes only; Mantine is for the shell (tabs, toolbar, dialogs, forms)
- FSMonitor is always available — latest Git required, no fallback code
- Virtualised lists use `@tanstack/react-virtual` with `overscan: 15`

## Scope limits (do not add without discussion)

### Features explicitly excluded
- **Remote branches** — local branches only, no ahead/behind counts
- **Tag display** — adds object-dereference overhead and noise
- **Merge graph / commit graph visualisation** — first-parent walk only; showing all parents requires walking the full DAG and is prohibitively slow in large monorepos
- **Per-commit insertion/deletion stats in the list** — `git log --stat` / `--shortstat` diffs every commit's tree; never add stat columns to `CommitList` rows
- **`git blame`** — extremely slow on large files with deep history
- **Commit search** — `git log --grep` is slow without a commit-graph cache
- **Stash management** — out of scope for the 5-operation goal
- **Submodule status** — submodule recursion is a major source of latency; all git commands use `--ignore-submodules=all` where applicable
- **Tab persistence across restarts** (deferred)
- **Credential UI** — assume creds pre-configured in system git

### Performance-driven implementation choices
These aren't missing features — they're deliberate decisions that keep the app fast:
- `load_commits` uses `.first_parent_only()` — never remove this
- `get_commit_detail` passes `--first-parent` to `diff-tree` — without this a large monorepo merge can return thousands of file entries
- `get_working_tree_status` passes `--no-renames` — disables O(n²) rename detection
- `get_working_tree_status` passes `--ignore-submodules=all` — prevents recursing into submodule directories

## Frontend structure

- `src/store.ts` — Zustand store: `tabs`, `activeTabId`, `openTab`, `closeTab`, `setActiveTab`, `bumpListKey`, `bumpStatusKey`
- `src/App.tsx` — tabbed shell, platform detection, Open Folder dialog, Windows title bar + controls
- `src/tokens.css` — all `--lg-*` design tokens with naming convention guide at the top
- `src/components/CommitList.tsx` — virtualised commit history (plain CSS rows, no Mantine inside)
- `src/components/CommitDetail.tsx` — commit diff view; exports `UNCOMMITTED` sentinel
- `src/components/BranchSwitcher.tsx` — branch list with TanStack Query cache
- Mantine CSS imported once in `src/main.tsx`

## CSS tokens (`src/tokens.css`)

All tokens are prefixed `--lg-`. Full reference and naming convention are in the comment block at the top of `tokens.css`. Key rule:

> **`--lg-hover-bg` and `--lg-ink-*` are for content areas. `--lg-chrome-*` is only for the title/tab bar.** Win window-control buttons use `--lg-ink-soft` / `--lg-hover-bg` (not chrome variants).

## Platform detection & browser mock

`App.tsx` detects `"windows" | "macos" | "linux"` via `navigator.userAgent`. In browser mock mode (`__TAURI_INTERNALS__` absent) it defaults to `"windows"` so the Windows chrome is visible for styling work.

Running `npm run dev` activates the mock layer — Vite aliases all `@tauri-apps/*` imports to shims in `src/mock/`. `tauri-core.ts` handles all `invoke()` calls with realistic latency and fixture data. Use the **`Vite (browser mock)`** launch config (port 5173) to preview; **`Tauri dev (full app)`** runs the real Rust backend on port 1420.

## Rust commands (`src-tauri/src/lib.rs`)

All commands take `tab_id: String` as their first arg. `State` and `AppHandle` are injected by Tauri.

```
// Repo lifecycle
open_repo(path: String) → TabInfo          canonicalise, validate, register, start FS watcher
close_tab(tab_id) → ()                     remove from AppState
clear_detail_cache(tab_id) → ()            clear CommitDetail cache; call before bumpListKey

// Commit history
load_commits(tab_id, after_oid: Option<String>, limit: usize) → Vec<CommitInfo>
  First-parent walk from HEAD (after_oid=None) or cursor. Returns ≤ limit items.

// Branches
list_branches(tab_id) → Vec<BranchInfo>                    { name, is_head }
create_branch(tab_id, name: String) → ()                   git checkout -b
checkout_branch(tab_id, branch: String) → ()  [streaming]

// Commit detail & diffs
get_commit_detail(tab_id, oid: String) → CommitDetail       cached per tab
get_file_diff(tab_id, oid: String, file_path: String) → String

// Working tree
get_working_tree_status(tab_id) → WorkingTreeStatus         { staged, unstaged: Vec<StatusEntry> }
get_staged_diff(tab_id, file_path: String) → String
get_unstaged_diff(tab_id, file_path: String, is_untracked: bool) → String
stage_file(tab_id, file_path: String) → ()
unstage_file(tab_id, file_path: String) → ()
discard_changes(tab_id, file_path: String) → ()
delete_untracked(tab_id, file_path: String) → ()
apply_patch(tab_id, patch: String, reverse: bool) → ()      git apply --cached [--reverse]

// Remote
pull_with_rebase(tab_id) → ()  [streaming]
```

## Streaming event pattern

Streaming commands emit Tauri events instead of blocking:
- `"<prefix>:line"` `{ line: String }` — stdout/stderr line
- `"<prefix>:done"` `{}` — exited 0
- `"<prefix>:error"` `{ message: String }` — exited non-zero

Prefixes: `checkout`, `pull`. `GitOutputDrawer` handles this pattern generically.
