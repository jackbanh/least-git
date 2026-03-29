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

- `src/store.ts` — Zustand store: `tabs`, `activeTabId`, `openTab`, `closeTab`, `setActiveTab`
- `src/App.tsx` — tabbed shell, Open Folder dialog trigger
- `src/components/CommitList.tsx` — virtualised commit history (plain CSS rows, no Mantine inside)
- Mantine CSS imported once in `src/main.tsx`
- PostCSS config in `postcss.config.cjs`

## Rust commands (src-tauri/src/lib.rs)

- `open_repo(path)` → `TabInfo` — canonicalises path, validates git repo, caches in AppState
- `close_tab(tab_id)` — removes from AppState
- `load_commits(tab_id, offset, limit)` → `Vec<CommitInfo>` — first-parent walk via gix, paginated by offset
