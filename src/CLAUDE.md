# Frontend

## Structure

- `store.ts` — Zustand store: `tabs`, `activeTabId`, `openTab`, `closeTab`, `setActiveTab`, `bumpListKey`, `bumpStatusKey`, `bumpUntrackedKey`

## Refresh signals — three keys, three costs

Each tab carries three counters. Bumping the wrong one is a performance bug, not just a redundant fetch:

| key | triggers | cost | bumped by |
|---|---|---|---|
| `listKey` | commit list + branches + tracked status | ~100 ms | `refs` watcher events, manual Refresh, commit, pull |
| `statusKey` | tracked working-tree status only | ~300 ms | `index` watcher events, window focus |
| `untrackedKey` | untracked-file scan **only** | **5–9 s** on a large monorepo | window focus (20 s cooldown), manual Refresh, the Scan button |

`untrackedKey` is separate because the scan is a full directory walk (measured: 27k directories on a 100k-file repo, no benefit from `core.untrackedCache`) and because nothing else can tell us about new files — the FS watcher covers `.git/` only. Staging, unstaging, committing and branch switches cannot create untracked files, so they must never bump it.
- `App.tsx` — tabbed shell, platform detection, Open Folder dialog, Windows title bar + controls
- `tokens.css` — all `--lg-*` design tokens; naming convention guide at the top of the file
- `components/CommitList.tsx` — virtualised commit history (plain CSS rows, no Mantine inside)
- `components/CommitDetail.tsx` — commit diff view; exports `UNCOMMITTED` sentinel
- `components/FilePreview.tsx` — syntax-highlighted preview of untracked files (no diff exists for new files); shares token colors with `DiffViewer.css`
- `components/BranchSwitcher.tsx` — branch list with TanStack Query cache
- Mantine CSS imported once in `main.tsx`

## CSS tokens (`tokens.css`)

All tokens are prefixed `--lg-`. Full reference and naming convention are in the comment block at the top of `tokens.css`. Key rule:

> **`--lg-hover-bg` and `--lg-ink-*` are for content areas. `--lg-chrome-*` is only for the title/tab bar.** Win window-control buttons use `--lg-ink-soft` / `--lg-hover-bg` (not chrome variants).

## Platform detection

`App.tsx` detects `"windows" | "macos" | "linux"` via `navigator.userAgent`. In browser mock mode (`__TAURI_INTERNALS__` absent) it defaults to `"windows"` so the Windows chrome is visible for styling work.

## Browser mock & preview

Running `npm run dev` activates the mock layer — Vite aliases all `@tauri-apps/*` imports to shims in `mock/`. `mock/tauri-core.ts` handles all `invoke()` calls with realistic latency and fixture data from `mock/fixtures.ts`.

Use the **`Vite (browser mock)`** launch config (port 5173) to preview styling changes. **`Tauri dev (full app)`** runs the real Rust backend on port 1420.
