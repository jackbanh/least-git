# least-git

Minimal Git GUI (5 operations only: history, branch switch, commit, pull, push) built for large monorepos.

## Stack

- **Tauri 2** — native shell, no Chromium
- **React + TypeScript + Vite** — UI in `src/`
- **Rust + Tokio** — all Git logic in `src-tauri/src/`
- **gix** — Git backend (not libgit2)
- **System git binary** — push/pull only (no reimplementing transport)
- **Mantine v9** — UI components for app chrome only
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

- **Remote branches** — local only, no ahead/behind counts
- **Tag display** — object-dereference overhead, not worth it
- **Merge graph** — first-parent walk only; full DAG is prohibitively slow in large monorepos
- **Per-commit stats** — never add insertion/deletion counts to `CommitList` rows
- **`git blame`** — slow on large files with deep history
- **Commit search** — slow without a commit-graph cache
- **Stash management** — out of scope for the 5-operation goal
- **Submodule status** — recursion is a major latency source
- **Tab persistence across restarts** (deferred)
- **Credential UI** — assume creds pre-configured in system git

## Domain-specific context

Loaded automatically when working in each area:
- `src-tauri/CLAUDE.md` — Rust commands, streaming events, git flag rationale
- `src/CLAUDE.md` — frontend structure, CSS tokens, browser mock & preview workflow
