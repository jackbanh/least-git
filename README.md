**Project: least-git** — a Git GUI client intentionally limited to 5 core operations (view history, switch branches, commit, pull, push), purpose-built for performance on large monorepos with 100k+ commits, thousands of files, and many branches/remotes.

**Platforms:** macOS and Windows (both testable; code signing scoped to macOS only, not a current priority)

**Stack:**
- **Tauri 2** (native shell, ~50ms startup, no Chromium overhead)
- **React + TypeScript** (UI layer — thin renderer only)
- **Rust + async Tokio** (all Git logic and state)
- **gitoxide** (pure Rust Git library — parallel pack reads, lazy streaming object access, better than libgit2 for this use case)
- **System git binary** (shelled out for push/pull only — no reimplementing SSH/HTTPS transport for MVP)

**Architecture:**
- Multiple repos open simultaneously in a tabbed interface — Rust core holds a `HashMap<TabId, Arc<RwLock<RepoState>>>`, each tab owns its own repo state and `.git` watcher
- Repo discovery via native Open Folder dialog — no auto-detect, no recent repos list in MVP
- Tauri IPC bridge is thin: UI calls `invoke()`, Rust emits streaming events back via `tauri::emit`
- Commit graph loaded in paginated chunks (e.g. 500 at a time) via `gix::revision::Walk` — never full DAG in memory
- UI uses virtualized lists (`@tanstack/virtual`) for history and file tree — ~30 DOM rows max at any time

**UI design:**
- Follows a subset of Sourcetree's layout and conventions — familiar to existing Sourcetree users but stripped to only the 5 core operations
- Remote branches are not shown anywhere in the UI — local branches only

**Key performance constraints to design around:**
- History view must render recent commits on the current branch with no perceptible delay — first page of results (e.g. 50–100 commits) must appear near-instantly even in repos with 100k+ total commits; virtual scroll handles the rest
- Branch switcher must feel instant for local branches — listing and switching must not block the UI; checkout should stream progress back rather than freezing until done
- Branch panel needs fuzzy search filter (thousands of branches) — filter runs client-side on already-loaded branch list, no round-trip per keystroke
- File tree must also be virtualized
- `git status` calls use Git's built-in FSMonitor daemon — latest Git version is required, no fallback for older versions

**Assumptions:**
- Git credentials are pre-configured in the system; push/pull may hang if they are not (acceptable for MVP)
- Minimum Git version: latest stable release (FSMonitor, `--pathspec-from-file`, and other modern features assumed available)

**MVP build order:**
1. Tauri shell + IPC round-trip
2. Tabbed repo interface + Open Folder dialog
3. History view (gitoxide → paginated → virtualized list)
4. Branch switcher (local branches only, fuzzy filter + checkout)
5. Commit panel (status, diff, stage/unstage, commit)
6. Pull/push (shell to system git, stream progress to status bar)

**Validated decisions:**
- Name is **least-git** — no conflicts with existing git clients, intentional minimalism is the brand
- No existing free GUI client solves this — lazygit, GitButler, Sourcetree all have documented performance failures at this repo scale
- gitoxide over libgit2 for the Git backend; system git for network ops
- UI modeled on Sourcetree's layout — familiar baseline, not a blank-slate design
- Remote branches explicitly out of scope — reduces branch state complexity significantly

**What Claude Code should start with:** scaffold the Tauri 2 project, establish the Rust/React IPC pattern, implement the tabbed repo shell with Open Folder, and get a single `load_commits` command streaming paginated results from gitoxide to a virtualized React list. That's the hardest and most foundational piece — everything else builds on it.
