<div align="center">

# least-git

### The Git GUI that stays instant on 100k-commit monorepos.

**Your AI agent writes the code. least-git is how you review it — fast.**

[![CI](https://github.com/jackbanh/least-git/actions/workflows/ci.yml/badge.svg)](https://github.com/jackbanh/least-git/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.6.0-blue)](package.json)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)
[![Backend: gitoxide](https://img.shields.io/badge/git%20backend-gitoxide-orange)](https://github.com/GitoxideLabs/gitoxide)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

## Why least-git exists

Open a large monorepo — hundreds of thousands of commits, hundreds of thousands of files, thousands of branches — in Sourcetree, GitButler, or a heavy Electron client, and the app slows to a crawl: long spinners, a frozen window, a history view that keeps loading and never finishes. These tools try to do everything, and they get slow at scale.

**least-git does four things, and does them instantly.**

It is built for a modern workflow: your **AI coding agent makes most of the changes**, and you need a simple, fast way to *review* them — read the history, look at the diffs, stage the changes that belong together, and commit. Publishing (push) stays in the terminal or with the agent. least-git does not try to do all of Git. It is a fast tool for reviewing and committing an agent's work.

## What it does

Four operations. Nothing extra.

| Operation | What you get |
|---|---|
| **Read history** | A first-parent commit list that shows the first page *instantly*, even at 100k+ commits. Virtual scrolling loads the rest — the full commit graph is never held in memory. |
| **Switch branches** | Type to filter thousands of local branches, with no delay between keystrokes. Checkout shows live progress instead of freezing the window. |
| **Commit, hunk by hunk** | Stage and unstage individual hunks and lines in an interactive diff view. See exactly what the agent changed, then commit only the parts that belong together. |
| **Pull with rebase** | One-click pull that detects `origin/main` or `origin/master` automatically and shows the output live. |

That is the whole app. There is no merge graph, no submodule scanning, no tag lookups, and no stash manager — each of those makes a large repo slower, and none of them is what you need when reviewing an agent's work.

## Why it's fast

least-git is fast because of how it is built, not because of later tuning. Speed is the main goal.

- **Native shell, no Chromium.** Built on **Tauri 2** — it starts in about 50 ms and uses much less memory than an Electron client. The UI is a thin React layer; nothing heavy runs in the webview.
- **Rust and gitoxide backend.** All Git logic runs in async Rust on **[gitoxide](https://github.com/GitoxideLabs/gitoxide)** (a pure-Rust Git library with parallel pack reads and lazy, streaming object access). No libgit2, and no Node.js in the performance-critical path.
- **Paginated, first-parent history.** Commits load in small pages using a first-parent walk. The first screen appears with no visible delay in repos with 100k+ commits, and scrolling loads more as you go.
- **Virtual scrolling everywhere.** The history and file trees keep only about 30 rows in the DOM at a time, no matter how large the repo. Rows use plain, tuned CSS — no component cost that adds up while scrolling.
- **FSMonitor-aware status.** `git status` uses Git's built-in FSMonitor daemon. Tracked changes appear in about **400 ms** on a 300k-file monorepo, compared to about **2.9 s** for a full untracked-file scan. Untracked files are loaded separately, in parallel, so they never block the changes you care about.
- **Nothing blocks the window.** Every long operation — checkout, pull — runs async and streams its output line by line to the UI. The app never freezes while waiting on Git.

## Built for the AI coding workflow

least-git assumes you are no longer typing most of the diffs yourself.

- **Review first.** The interface is built for *reading* an agent's changes and *choosing what to keep*. Hunk-level staging is the main feature, not an add-on.
- **Push is left out on purpose.** Your agent or terminal handles publishing. Leaving it out keeps the app small and the branch model simple — local branches only, with no ahead/behind tracking.
- **Familiar layout.** The UI follows a reduced version of Sourcetree's conventions, so it is easy to read if you have used a Git GUI before — without the parts that made the older tools slow.

## Screenshots

> _Coming soon._ Add screenshots or a short demo GIF here. The clearest ones to show are the history view, hunk-level staging, and the branch switcher.

<!--
![History view](docs/screenshots/history.png)
![Hunk-level staging](docs/screenshots/staging.png)
![Branch switcher](docs/screenshots/branches.png)
-->

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | Native and small; starts in about 50 ms; no Chromium |
| UI | **React + TypeScript + Vite** | A thin rendering layer only |
| Git logic | **Rust + Tokio** | Async, non-blocking, with all state on the backend |
| Git backend | **gitoxide** | Pure Rust, parallel pack reads, streaming access |
| Network Git | **System `git` binary** | Pull and checkout only — no reimplementing SSH/HTTPS transport |
| Components | **Mantine v9** | App chrome only; never inside virtualised rows |
| State | **Zustand** | One store slice per open repo tab |
| Lists | **@tanstack/react-virtual** | Keeps the DOM small at any repo size |

## Contributing

Working on least-git? The design constraints and internals are documented for both people and AI agents in the `CLAUDE.md` files:

- [`CLAUDE.md`](CLAUDE.md) — project overview, architecture, and scope limits
- [`src-tauri/CLAUDE.md`](src-tauri/CLAUDE.md) — Rust commands, streaming events, and the performance-driven git flags
- [`src/CLAUDE.md`](src/CLAUDE.md) — frontend structure, CSS tokens, and the browser-mock preview workflow

The scope limits in those files are intentional. Please open a discussion before adding operations beyond the core four.

## License

[MIT](LICENSE) © Jack Banh
