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

- Remote branches are not shown anywhere — local branches only
- No tab persistence across restarts (deferred)
- No credential UI — assume creds pre-configured in system git
- No diff view beyond what's needed for the commit panel

## Frontend structure

- `src/store.ts` — Zustand store: `tabs`, `activeTabId`, `openTab`, `closeTab`, `setActiveTab`, `bumpListKey`, `bumpStatusKey`
- `src/App.tsx` — tabbed shell, platform detection, Open Folder dialog, Windows title bar + controls
- `src/tokens.css` — all design tokens (`--lg-*`), see CSS tokens section below
- `src/components/CommitList.tsx` — virtualised commit history (plain CSS rows, no Mantine inside)
- `src/components/CommitDetail.tsx` — commit diff view; exports `UNCOMMITTED` sentinel
- `src/components/BranchSwitcher.tsx` — branch list with TanStack Query cache
- Mantine CSS imported once in `src/main.tsx`
- PostCSS config in `postcss.config.cjs`

## Platform detection

`App.tsx` detects the platform at module load and drives conditional rendering (Windows title bar, macOS traffic lights, etc.):

```ts
// In browser mock mode (__TAURI_INTERNALS__ absent) defaults to "windows"
// so the Windows chrome is visible for styling work.
const platform: "windows" | "macos" | "linux"
```

## Browser mock (styling without Tauri)

Running `npm run dev` (no Tauri backend) activates the mock layer. Vite aliases all `@tauri-apps/*` imports to shims in `src/mock/`:

| Mock file | Replaces |
|---|---|
| `src/mock/tauri-core.ts` | `@tauri-apps/api/core` (`invoke`) |
| `src/mock/tauri-event.ts` | `@tauri-apps/api/event` (`listen`) |
| `src/mock/tauri-window.ts` | `@tauri-apps/api/window` |
| `src/mock/tauri-dialog.ts` | `@tauri-apps/plugin-dialog` |
| `src/mock/tauri-log.ts` | `@tauri-apps/plugin-log` |
| `src/mock/fixtures.ts` | fixture data (branches, commits, diffs) |

**`src/mock/tauri-core.ts`** handles all `invoke()` calls with realistic latency (matching real Windows monorepo logs) and returns fixture data. When no Tauri context is present, `platform` defaults to `"windows"` so the full Windows chrome is visible in the browser.

To preview: use the **`Vite (browser mock)`** launch config (port 5173). The **`Tauri dev (full app)`** config runs the real Rust backend on port 1420.

## CSS tokens (`src/tokens.css`)

All tokens are prefixed `--lg-`. Use the right category — don't reach for a chrome token when you need a surface token:

### Surfaces & interaction (use for panels, lists, hover states)
| Token | Role |
|---|---|
| `--lg-page-bg` | outermost app background |
| `--lg-panel-bg` | secondary panels (detail pane, drawers) |
| `--lg-sidebar-bg` | sidebar / branch list background |
| `--lg-hover-bg` | generic hover state (rows, buttons) |
| `--lg-selected-bg` | selected row background |

### Borders
| Token | Role |
|---|---|
| `--lg-border` | standard dividers |
| `--lg-border-soft` | subtle/inner borders |
| `--lg-border-strong` | emphasis borders |

### Ink (text & icons — use for content areas, not chrome)
| Token | Role |
|---|---|
| `--lg-ink` | primary text |
| `--lg-ink-soft` | secondary text, toolbar icons |
| `--lg-ink-muted` | placeholder, tertiary |
| `--lg-ink-faint` | disabled, timestamps |

### Accent (sage green by default, follows `--lg-accent-hue`)
| Token | Role |
|---|---|
| `--lg-accent` | interactive highlights, HEAD branch dot |
| `--lg-accent-soft` | accent backgrounds |
| `--lg-accent-text` | accent-coloured text |

### Chrome (title bar / tab bar — follows accent hue, distinct from content)
| Token | Role |
|---|---|
| `--lg-chrome-bg` | title bar / tab bar background |
| `--lg-chrome-ink` | strong text inside chrome |
| `--lg-chrome-ink-soft` | normal text/icons inside chrome (app title, inactive tabs) |
| `--lg-chrome-ink-faint` | faint text inside chrome (macOS centered title) |
| `--lg-chrome-border` | chrome bottom border |
| `--lg-chrome-hover` | hover state for elements **inside** chrome (tab hover) |
| `--lg-chrome-tab-bg` | active tab background (near-white / near-dark) |

> **Rule of thumb:** `--lg-hover-bg` and `--lg-ink-*` are for content areas. `--lg-chrome-*` is only for the title/tab bar. The Windows window control buttons use `--lg-ink-soft` / `--lg-hover-bg` (not chrome variants) because they inherit the ink scale.

### Diff colours
| Token | Role |
|---|---|
| `--lg-diff-add-fg` / `--lg-diff-add-bg` / `--lg-diff-add-bar` | added line text / background / left accent bar |
| `--lg-diff-rem-fg` / `--lg-diff-rem-bg` / `--lg-diff-rem-bar` | removed line text / background / left accent bar |

### Status dots
| Token | Role |
|---|---|
| `--lg-added` | added file dot |
| `--lg-modified` | modified file dot |
| `--lg-deleted` | deleted file dot |
| `--lg-uncommitted` | uncommitted-changes dot |
| `--lg-sha` | commit SHA colour (warm amber) |

### Typography
| Token | Value |
|---|---|
| `--lg-font-serif` | Fraunces → Iowan Old Style → Georgia |
| `--lg-font-sans` | IBM Plex Sans → system sans |
| `--lg-font-mono` | IBM Plex Mono → SF Mono → Menlo |

## Rust commands (`src-tauri/src/lib.rs`)

All commands take `tab_id: String` as their first arg (except where noted). `State` and `AppHandle` params are injected by Tauri and not passed from the frontend.

### Repo lifecycle
```
open_repo(path: String) → TabInfo
  Canonicalises path, validates git repo, registers in AppState, starts FS watcher.

close_tab(tab_id) → ()
  Removes tab from AppState (drops FS watcher).

clear_detail_cache(tab_id) → ()
  Clears the per-tab CommitDetail LRU cache. Call before bumpListKey on refresh.
```

### Commit history
```
load_commits(tab_id, after_oid: Option<String>, limit: usize) → Vec<CommitInfo>
  First-parent walk. after_oid = None starts from HEAD; pass the parent_oid of the
  last visible commit for pagination. Returns ≤ limit items.
```

### Branches
```
list_branches(tab_id) → Vec<BranchInfo>
  All local branches. BranchInfo: { name, is_head }.

create_branch(tab_id, name: String) → ()
  git checkout -b <name>

checkout_branch(tab_id, branch: String) → ()  [streaming]
  Emits "checkout:line" / "checkout:done" / "checkout:error" events.
```

### Commit detail & diffs
```
get_commit_detail(tab_id, oid: String) → CommitDetail
  Full commit metadata + changed file list. Results are cached per tab; cleared by
  clear_detail_cache.

get_file_diff(tab_id, oid: String, file_path: String) → String
  Unified diff for one file in a commit (git show).
```

### Working tree
```
get_working_tree_status(tab_id) → WorkingTreeStatus
  Staged + unstaged file lists. WorkingTreeStatus: { staged: Vec<StatusEntry>,
  unstaged: Vec<StatusEntry> }. StatusEntry: { path, old_path?, status }.

get_staged_diff(tab_id, file_path: String) → String
  git diff --cached for one file.

get_unstaged_diff(tab_id, file_path: String, is_untracked: bool) → String
  git diff for one file; if is_untracked, diffs against /dev/null.

stage_file(tab_id, file_path: String) → ()
unstage_file(tab_id, file_path: String) → ()
discard_changes(tab_id, file_path: String) → ()   git restore
delete_untracked(tab_id, file_path: String) → ()  removes file from disk

apply_patch(tab_id, patch: String, reverse: bool) → ()
  git apply --cached [--reverse] — used for hunk-level staging.
```

### Remote operations
```
pull_with_rebase(tab_id) → ()  [streaming]
  git pull --rebase. Emits "pull:line" / "pull:done" / "pull:error" events.
```

## Streaming event pattern

Commands that run git processes stream output via Tauri events rather than blocking:

```
"<prefix>:line"   { line: String }   — one line of stdout/stderr
"<prefix>:done"   {}                 — process exited 0
"<prefix>:error"  { message: String } — process exited non-zero
```

Prefixes: `checkout`, `pull`. The frontend `GitOutputDrawer` component handles this pattern generically.
