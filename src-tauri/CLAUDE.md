# Rust / Git operations

## Commands (`src/lib.rs`)

All commands take `tab_id: String` as their first arg. `State` and `AppHandle` are injected by Tauri — do not pass from the frontend.

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
get_working_tree_status(tab_id) → WorkingTreeStatus         { staged, unstaged: Vec<StatusEntry> } — tracked files only, no untracked scan
get_untracked_files(tab_id) → Vec<String>                   paths only; frontend fires this in parallel with get_working_tree_status
get_staged_diff(tab_id, file_path: String) → String
get_unstaged_diff(tab_id, file_path: String, is_untracked: bool) → String
read_file_preview(tab_id, file_path: String) → FilePreview   { content, is_binary, truncated } — untracked file contents for preview, capped at 512 KiB (NUL byte ⇒ is_binary)
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

## Performance-driven git flags

These are deliberate — do not remove:
- `load_commits` uses `.first_parent_only()` — never walk the full DAG
- `get_commit_detail` passes `--first-parent` to `diff-tree` — without this a large monorepo merge commit can return thousands of file entries (one per parent)
- `get_working_tree_status` uses `git status --porcelain=v1 -z` (single process) instead of three separate `diff`/`ls-files` calls — reads the index once, is FSMonitor-aware, and avoids 2 extra process spawns (~400–800 ms on Windows)
- `get_working_tree_status` passes `--no-optional-locks` as a **top-level git flag** (before the subcommand) — skips acquiring `index.lock` for this read-only check
- `get_working_tree_status` passes `--no-renames` — disables O(n²) rename detection across all changed files
- `get_working_tree_status` passes `--ignore-submodules=all` — prevents recursing into submodule directories
- `get_working_tree_status` passes `--untracked-files=no` — untracked directory scanning was the dominant latency (~2.9 s on a 300k-file monorepo even with FSMonitor); untracked paths are fetched separately via `get_untracked_files` (`git ls-files --others`) so tracked changes appear in ~400 ms
- `get_untracked_files` uses `git ls-files --others --exclude-standard --no-empty-directory -z` — dedicated untracked scan; frontend fires it in parallel so it doesn't block the tracked-changes display
