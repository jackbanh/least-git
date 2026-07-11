# least-git

Minimal Git GUI (4 operations only: history, branch switch, commit, pull) built for large monorepos.

Positioned as a **companion to an AI coding workflow**: the AI agent makes most of the writes, and the developer uses least-git to *review* those changes — reading history, inspecting diffs, and staging/committing at the hunk level. Optimised for fast, low-friction review on huge repos rather than for driving Git end-to-end. Publishing changes (push) is intentionally left to the terminal / agent and is out of scope.

## Stack

- **Tauri 2** — native shell, no Chromium
- **React + TypeScript + Vite** — UI in `src/`
- **Rust + Tokio** — all Git logic in `src-tauri/src/`
- **gix** — Git backend (not libgit2)
- **System git binary** — pull/checkout only (no reimplementing transport)
- **Mantine v9** — UI components for app chrome only
- **Zustand** — tab state
- **@tanstack/react-virtual** — virtualised lists

## Architecture

- `AppState` is `DashMap<String, RepoEntry>` (tab id → repo path + name), managed by Tauri
- Tab id is the canonicalised repo path
- Repos are opened fresh per command call (`gix::open`) — no cached `Repository` handle
- IPC pattern: frontend calls `invoke()`, Rust returns data or emits streaming events via `tauri::emit`

## UI components — use the framework, don't rebuild it

- **Before hand-rolling any interactive primitive, check `@mantine/core` first — it almost certainly exists.** This includes: dropdown/menu → `Menu`, popover → `Popover`, dialog → `Modal`, drawer → `Drawer`, segmented toggle → `SegmentedControl`, colour picker swatch → `ColorSwatch`, badge/dot → `Badge`/`Indicator`, tooltip → `Tooltip`, text field → `TextInput`/`Textarea`, button/icon button → `Button`/`ActionIcon`, progress → `Progress`, spinner → `Loader`. Hand-rolled HTML is **only** for virtualised list rows (see perf rule).
- **Behaviour hooks live in `@mantine/hooks`** (a dependency): `useClickOutside`, `useDisclosure`, `useLocalStorage`, `useDebouncedValue`, etc. Don't reimplement click-outside listeners or localStorage effects.
- **Mantine is themed** (`src/theme.ts`): components inherit the app fonts and the accent (which follows `--lg-accent-hue`), and Mantine's colour scheme is synced to the app theme in `App.tsx`. So a Mantine component should already match the app — **do not add per-component CSS palette overrides**. If one looks wrong, fix the theme, not the component.

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
- **Push / publishing** — out of scope; the AI agent or terminal handles pushing. least-git is a review-and-commit companion, not a full Git driver
- **Stash management** — out of scope for the minimal-operation goal
- **Submodule status** — recursion is a major latency source
- **Tab persistence across restarts** (deferred)
- **Credential UI** — assume creds pre-configured in system git

## Domain-specific context

Loaded automatically when working in each area:
- `src-tauri/CLAUDE.md` — Rust commands, streaming events, git flag rationale
- `src/CLAUDE.md` — frontend structure, CSS tokens, browser mock & preview workflow
