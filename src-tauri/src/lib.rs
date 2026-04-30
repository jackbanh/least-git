use dashmap::DashMap;
use gix::bstr::ByteSlice;
use log::{info, warn};
use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
#[allow(unused_imports)]
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, State};

/// Spawn an async git process. On Windows, `CREATE_NO_WINDOW` prevents a
/// console window from flashing when the app is launched as a GUI executable.
fn git_async() -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new("git");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

// ── Shared state ────────────────────────────────────────────────────────────

struct RepoEntry {
    path: PathBuf,
    name: String,
    /// Caches CommitDetail by OID. Cleared on refresh (bumpListKey → close/reopen tab).
    detail_cache: Mutex<HashMap<String, CommitDetail>>,
    /// Keeps the filesystem watcher alive for the lifetime of the tab.
    _watcher: Mutex<Option<notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
}

type AppState = DashMap<String, RepoEntry>;

fn get_repo_path(tab_id: &str, state: &State<'_, AppState>) -> Result<PathBuf, String> {
    state
        .get(tab_id)
        .map(|e| e.path.clone())
        .ok_or_else(|| format!("Tab not found: {tab_id}"))
}

// ── Serialisable types ───────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub id: String,
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    /// OID of this commit's first parent, or None if it is the root commit.
    /// The frontend passes this back as `after_oid` for the next page so that
    /// Rust can start the walk directly without decoding the cursor commit.
    pub parent_oid: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
}

#[derive(Serialize, Clone)]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String, // "A", "M", "D", "R", "C"
}

#[derive(Serialize, Clone)]
pub struct CommitDetail {
    pub oid: String,
    pub summary: String,
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub files: Vec<ChangedFile>,
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn open_repo(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<TabInfo, String> {
    let canonical = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let id = canonical.to_string_lossy().to_string();

    if state.contains_key(&id) {
        let entry = state.get(&id).unwrap();
        return Ok(TabInfo {
            id,
            path: entry.path.to_string_lossy().to_string(),
            name: entry.name.clone(),
        });
    }

    let repo = gix::open(&canonical).map_err(|e| format!("Not a git repository: {e}"))?;
    let git_dir = repo.git_dir().to_path_buf();

    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo")
        .to_string();

    // ── Filesystem watcher ────────────────────────────────────────────────────
    // Watch only .git/ (not the working tree — too expensive for large monorepos).
    // Debounce at 500 ms so a burst of related changes (commit, rebase, etc.)
    // coalesces into a single frontend event.
    let watcher = {
        let tab_id = id.clone();
        let app_handle = app.clone();
        match new_debouncer(
            Duration::from_millis(500),
            move |result: notify_debouncer_mini::DebounceEventResult| {
                let events = match result {
                    Ok(evs) => evs,
                    Err(errs) => {
                        warn!("watcher errors: {errs:?}");
                        return;
                    }
                };
                // Skip lock files — they're transient and always paired with
                // the real file write, which will fire its own event.
                let events: Vec<_> = events
                    .iter()
                    .filter(|ev| ev.path.extension().is_none_or(|e| e != "lock"))
                    .collect();
                if events.is_empty() {
                    return;
                }
                let has_refs = events.iter().any(|ev| {
                    let name = ev.path.file_name().unwrap_or_default();
                    name == "HEAD"
                        || name == "packed-refs"
                        || ev.path.components().any(|c| c.as_os_str() == "refs")
                });
                let has_index = events
                    .iter()
                    .any(|ev| ev.path.file_name().unwrap_or_default() == "index");
                // "refs" supersedes "index": a commit touches both, but a full
                // commit-list refresh already covers the working-tree status.
                let kind = if has_refs {
                    "refs"
                } else if has_index {
                    "index"
                } else {
                    return;
                };
                info!("repo:changed tab={tab_id} kind={kind}");
                let _ = app_handle.emit(
                    "repo:changed",
                    serde_json::json!({ "tab_id": tab_id, "kind": kind }),
                );
            },
        ) {
            Ok(mut d) => {
                if let Err(e) = d.watcher().watch(&git_dir, RecursiveMode::Recursive) {
                    warn!("failed to watch {git_dir:?}: {e}");
                }
                Some(d)
            }
            Err(e) => {
                warn!("failed to create watcher for {git_dir:?}: {e}");
                None
            }
        }
    };

    state.insert(
        id.clone(),
        RepoEntry {
            path: canonical,
            name: name.clone(),
            detail_cache: Mutex::new(HashMap::new()),
            _watcher: Mutex::new(watcher),
        },
    );

    info!("opened repo: {name} ({id})");
    Ok(TabInfo { id: id.clone(), path: id, name })
}

#[tauri::command]
fn close_tab(tab_id: String, state: State<'_, AppState>) {
    state.remove(&tab_id);
    info!("closed tab: {tab_id}");
}

#[tauri::command]
fn clear_detail_cache(tab_id: String, state: State<'_, AppState>) {
    if let Some(entry) = state.get(&tab_id) {
        entry.detail_cache.lock().unwrap().clear();
    }
}

#[tauri::command]
fn load_commits(
    tab_id: String,
    after_oid: Option<String>,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<CommitInfo>, String> {
    let t = std::time::Instant::now();
    let from_cursor = after_oid.is_some();
    let path = get_repo_path(&tab_id, &state)?;

    // Determine where to start the walk.
    // `after_oid` is the first-parent OID of the last commit already shown
    // (taken from CommitInfo.parent_oid in the previous page response).
    // We parse the hex string directly into an ObjectId without any pack
    // verification — rev_parse_single does an existence check that costs
    // ~650 ms of random pack I/O on large repos. The OID came from our own
    // walk output so it is always valid; an invalid value would surface as a
    // walk error on the first iteration anyway.
    //
    // open_ms is logged separately so we can measure the benefit of caching
    // the gix Repository handle in RepoEntry (perf recommendation #2).
    let open_t = std::time::Instant::now();
    let repo = gix::open(&path).map_err(|e| e.to_string())?;
    let open_ms = open_t.elapsed().as_millis();

    let cursor_t = std::time::Instant::now();
    // Produce a plain ObjectId so both branches have the same type.
    // For cursor pages we parse hex directly — no pack verification, no I/O.
    // For HEAD we call head_id() (reads one symref file) and detach the lifetime.
    let start_id: gix::ObjectId = if let Some(oid_str) = after_oid {
        gix::ObjectId::from_hex(oid_str.trim().as_bytes())
            .map_err(|e| format!("invalid cursor OID: {e}"))?
    } else {
        repo.head_id().map_err(|e| e.to_string())?.detach()
    };
    let cursor_ms = cursor_t.elapsed().as_millis();

    let walk_t = std::time::Instant::now();
    // repo.rev_walk accepts plain ObjectId directly, unlike Id::ancestors().
    let walk = repo
        .rev_walk([start_id])
        .first_parent_only()
        .all()
        .map_err(|e| e.to_string())?;

    let mut commits = Vec::with_capacity(limit.min(100));
    for info in walk.take(limit) {
        let info = info.map_err(|e| e.to_string())?;
        let oid_str = info.id.to_string();
        let short_oid = oid_str[..7].to_string();

        let object = repo.find_object(info.id).map_err(|e| e.to_string())?;
        let commit = object
            .try_into_commit()
            .map_err(|e| format!("not a commit: {e:?}"))?;
        let decoded = commit.decode().map_err(|e| e.to_string())?;

        let end = decoded.message.find_byte(b'\n').unwrap_or(decoded.message.len());
        let summary = decoded.message[..end].to_str_lossy().trim().to_string();
        let parent_oid = decoded.parents.first().map(|p| p.to_string());

        commits.push(CommitInfo {
            oid: oid_str,
            short_oid,
            summary,
            author_name: decoded.author.name.to_str_lossy().to_string(),
            author_email: decoded.author.email.to_str_lossy().to_string(),
            timestamp: decoded.author.time.seconds,
            parent_oid,
        });
    }
    let walk_ms = walk_t.elapsed().as_millis();
    let total_ms = t.elapsed().as_millis();

    let msg = format!(
        "load_commits from={} open_ms={} returned={} cursor_ms={} walk_ms={} total_ms={}",
        if from_cursor { "cursor" } else { "HEAD" },
        open_ms,
        commits.len(),
        cursor_ms,
        walk_ms,
        total_ms,
    );
    if total_ms > 2000 {
        warn!("[SLOW] {msg}");
    } else {
        info!("{msg}");
    }
    if commits.is_empty() && !from_cursor {
        warn!("load_commits returned 0 commits from HEAD — repo may be empty or tab not registered");
    }
    Ok(commits)
}

#[tauri::command]
async fn list_branches(tab_id: String, state: State<'_, AppState>) -> Result<Vec<BranchInfo>, String> {
    let t = std::time::Instant::now();
    let path = get_repo_path(&tab_id, &state)?;

    // Use gix directly instead of spawning `git branch` — avoids subprocess
    // overhead (git startup, config parsing, process spawn) which is especially
    // expensive on network shares. gix reads packed-refs in-process.
    tokio::task::spawn_blocking(move || -> Result<Vec<BranchInfo>, String> {
        let open_t = std::time::Instant::now();
        let repo = gix::open(&path).map_err(|e| e.to_string())?;
        let open_ms = open_t.elapsed().as_millis();

        // Resolve the current HEAD branch name; None when HEAD is detached.
        let head_short: Option<String> = repo
            .head_name()
            .ok()
            .flatten()
            .map(|n| n.shorten().to_str_lossy().into_owned());

        let refs_t = std::time::Instant::now();
        let mut branches: Vec<BranchInfo> = repo
            .references()
            .map_err(|e| e.to_string())?
            .local_branches()
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|r| {
                let name = r.name().shorten().to_str_lossy().into_owned();
                let is_head = head_short.as_deref() == Some(name.as_str());
                BranchInfo { name, is_head }
            })
            .collect();
        let refs_ms = refs_t.elapsed().as_millis();

        branches.sort_unstable_by(|a, b| {
            let rank = |name: &str| match name { "main" | "master" => 0u8, _ => 1 };
            rank(&a.name).cmp(&rank(&b.name)).then(a.name.cmp(&b.name))
        });

        let total_ms = t.elapsed().as_millis();
        let msg = format!(
            "list_branches returned={} open_ms={} refs_ms={} total_ms={}",
            branches.len(), open_ms, refs_ms, total_ms,
        );
        if total_ms > 2000 { warn!("[SLOW] {msg}"); } else { info!("{msg}"); }

        Ok(branches)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_branch(
    tab_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = state
        .get(&tab_id)
        .ok_or_else(|| "tab not found".to_string())?
        .path
        .clone();
    let out = git_async()
        .args(["checkout", "-b", &name])
        .current_dir(&path)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        warn!("create_branch failed: {msg}");
        return Err(msg);
    }
    info!("created and checked out branch: {name}");
    Ok(())
}

#[tauri::command]
async fn checkout_branch(
    tab_id: String,
    branch: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    info!("checkout_branch: {branch}");
    let checkout_start = std::time::Instant::now();
    let mut child = git_async()
        .args(["-C", &path_str, "checkout", &branch])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let emit_line = {
        let app = app.clone();
        let tab_id = tab_id.clone();
        move |line: String| {
            let _ = app.emit("checkout:line", PullLine { tab_id: tab_id.clone(), line });
        }
    };
    let emit_line2 = emit_line.clone();

    let out_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emit_line(line);
        }
    });
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emit_line2(line);
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = tokio::join!(out_task, err_task);

    let _ = app.emit("checkout:done", PullDone { tab_id, success: status.success() });

    let elapsed = checkout_start.elapsed().as_millis();
    if !status.success() {
        warn!("checkout_branch failed: {branch} ({elapsed}ms)");
        return Err(format!("git checkout {} failed", branch));
    }

    info!("checkout_branch done: {branch} ({elapsed}ms)");
    Ok(())
}

#[tauri::command]
async fn get_commit_detail(
    tab_id: String,
    oid: String,
    state: State<'_, AppState>,
) -> Result<CommitDetail, String> {
    let short = &oid[..7.min(oid.len())];

    // Cache hit — return immediately without spawning any processes.
    {
        let entry = state.get(&tab_id).ok_or_else(|| format!("Tab not found: {tab_id}"))?;
        let cached = entry.detail_cache.lock().unwrap().get(&oid).cloned();
        if let Some(detail) = cached {
            info!("get_commit_detail oid={short} cache=hit");
            return Ok(detail);
        }
    }

    let t = std::time::Instant::now();
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();
    let oid_clone = oid.clone();

    // Run gix metadata lookup and git diff-tree concurrently.
    let meta_fut = tokio::task::spawn_blocking({
        let path = path.clone();
        let oid = oid.clone();
        move || -> Result<(String, String, String, String, i64, u128), String> {
            let open_t = std::time::Instant::now();
            let repo = gix::open(&path).map_err(|e| e.to_string())?;
            let open_ms = open_t.elapsed().as_millis();
            let commit_id = gix::ObjectId::from_hex(oid.trim().as_bytes())
                .map_err(|e| format!("Invalid OID: {e}"))?;
            let object = repo.find_object(commit_id).map_err(|e| e.to_string())?;
            let commit = object.try_into_commit().map_err(|e| format!("not a commit: {e:?}"))?;
            let decoded = commit.decode().map_err(|e| e.to_string())?;
            let (summary, body) = split_message(decoded.message);
            Ok((
                summary,
                body,
                decoded.author.name.to_str_lossy().to_string(),
                decoded.author.email.to_str_lossy().to_string(),
                decoded.author.time.seconds,
                open_ms,
            ))
        }
    });

    // --first-parent: on merge commits, only diff against the first parent.
    // Without this, diff-tree outputs files changed relative to ALL parents,
    // which on a large monorepo merge can be thousands of entries.
    let files_fut = git_async()
        .args(["-C", &path_str, "diff-tree", "--no-commit-id", "-r", "--name-status", "--first-parent", &oid_clone])
        .output();

    let (meta_res, files_out) = tokio::try_join!(
        async { meta_fut.await.map_err(|e: tokio::task::JoinError| e.to_string())? },
        async { files_fut.await.map_err(|e| e.to_string()) }
    )?;

    let (summary, body, author_name, author_email, timestamp, open_ms) = meta_res;
    let mut files = Vec::new();
    for line in String::from_utf8_lossy(&files_out.stdout).lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 2 { continue; }
        let status = parts[0][..1].to_string();
        let (file_path, old_path) = if (status == "R" || status == "C") && parts.len() == 3 {
            (parts[2].to_string(), Some(parts[1].to_string()))
        } else {
            (parts[1].to_string(), None)
        };
        files.push(ChangedFile { path: file_path, old_path, status });
    }

    let total_ms = t.elapsed().as_millis();
    let file_count = files.len();
    let msg = format!("get_commit_detail oid={short} cache=miss open_ms={open_ms} files={file_count} total_ms={total_ms}");
    if total_ms > 2000 {
        warn!("[SLOW] {msg}");
    } else {
        info!("{msg}");
    }

    let detail = CommitDetail { oid: oid.clone(), summary, body, author_name, author_email, timestamp, files };

    // Store in cache.
    if let Some(entry) = state.get(&tab_id) {
        entry.detail_cache.lock().unwrap().insert(oid, detail.clone());
    }

    Ok(detail)
}

#[tauri::command]
async fn get_file_diff(
    tab_id: String,
    oid: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    // --root handles initial commits (diffs against empty tree)
    let output = git_async()
        .args([
            "-C", &path_str,
            "diff-tree", "--root", "--no-commit-id", "-r", "-p", "--no-color", "-M",
            &oid, "--", &file_path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ── Working tree ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct StatusEntry {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String, // "M", "A", "D", "R", "?"
}

#[derive(Serialize, Clone)]
pub struct WorkingTreeStatus {
    pub staged: Vec<StatusEntry>,
    pub unstaged: Vec<StatusEntry>,
}

/// Splits a raw git commit message into (summary, body).
/// Summary is the first line (trimmed). Body is everything after, also trimmed.
fn split_message(msg: &[u8]) -> (String, String) {
    let end = msg.iter().position(|&b| b == b'\n').unwrap_or(msg.len());
    let summary = String::from_utf8_lossy(&msg[..end]).trim().to_string();
    let body = if end < msg.len() {
        String::from_utf8_lossy(&msg[end..]).trim().to_string()
    } else {
        String::new()
    };
    (summary, body)
}

#[cfg(test)]
fn parse_branches(raw: &str) -> Vec<BranchInfo> {
    let mut branches: Vec<BranchInfo> = raw
        .lines()
        .filter(|l| l.len() > 1)
        .map(|line| {
            let is_head = line.starts_with('*');
            BranchInfo { name: line[1..].to_string(), is_head }
        })
        .collect();
    branches.sort_unstable_by(|a, b| {
        let rank = |name: &str| match name {
            "main" | "master" => 0u8,
            _ => 1,
        };
        rank(&a.name).cmp(&rank(&b.name)).then(a.name.cmp(&b.name))
    });
    branches
}

/// Parse `git status --porcelain=v1 -z` output into (staged, unstaged) lists.
///
/// With `-z` the stream is NUL-terminated: `"XY path\0"` for ordinary entries and
/// `"XY new\0old\0"` for renames (only possible without `--no-renames`, kept for
/// safety). `X` = index status, `Y` = worktree status; `' '` means clean, `'?'`
/// means untracked. Untracked entries (`??`) go into `unstaged`.
fn parse_porcelain_status(raw: &str) -> (Vec<StatusEntry>, Vec<StatusEntry>) {
    let mut staged: Vec<StatusEntry> = Vec::new();
    let mut unstaged: Vec<StatusEntry> = Vec::new();
    let mut iter = raw.split('\0').peekable();
    while let Some(record) = iter.next() {
        if record.len() < 4 { continue; } // need "XY " + at least one path char
        let x = record.as_bytes()[0] as char;
        let y = record.as_bytes()[1] as char;
        // byte 2 is a space separator
        let path = record[3..].to_string();

        // Rename/copy in index: next NUL record is the original path.
        // Shouldn't happen with --no-renames, but handle gracefully.
        let old_path: Option<String> = if (x == 'R' || x == 'C')
            && iter.peek().is_some_and(|s| !s.is_empty())
        {
            iter.next().map(|s| s.to_string())
        } else {
            None
        };

        if x == '?' && y == '?' {
            // Untracked file
            unstaged.push(StatusEntry { path, old_path: None, status: "?".to_string() });
        } else {
            if x != ' ' && x != '?' {
                staged.push(StatusEntry {
                    path: path.clone(),
                    old_path: old_path.clone(),
                    status: x.to_string(),
                });
            }
            if y != ' ' && y != '?' {
                unstaged.push(StatusEntry { path, old_path: None, status: y.to_string() });
            }
        }
    }
    (staged, unstaged)
}

#[cfg(test)]
fn parse_name_status(output: &str) -> Vec<StatusEntry> {
    output
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            if parts.len() < 2 {
                return None;
            }
            let status = parts[0][..1].to_string();
            let (path, old_path) = if (status == "R" || status == "C") && parts.len() == 3 {
                (parts[2].to_string(), Some(parts[1].to_string()))
            } else {
                (parts[1].to_string(), None)
            };
            Some(StatusEntry { path, old_path, status })
        })
        .collect()
}

#[tauri::command]
async fn get_working_tree_status(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    let t = std::time::Instant::now();
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    // Single `git status` call instead of three separate processes (diff --cached,
    // diff, ls-files --others). Benefits:
    //   • Reads the index once — no redundant pack I/O.
    //   • FSMonitor-aware: if core.fsmonitor is configured, git consults the daemon
    //     and skips stat()-ing clean directories, which is the main source of the
    //     5–14 s cost on large monorepos. The old ls-files call bypassed FSMonitor.
    //   • Eliminates two extra git process spawns (~400–800 ms on Windows).
    // --no-optional-locks: top-level git flag (must precede subcommand) — skips
    //   acquiring index.lock for this read-only check.
    // --no-renames / --ignore-submodules=all carried forward from before.
    let output = git_async()
        .args([
            "--no-optional-locks",
            "-C", &path_str,
            "status",
            "--porcelain=v1",
            "-z",
            "--no-renames",
            "--ignore-submodules=all",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        warn!("get_working_tree_status git status failed: {stderr}");
        return Err(format!("git status failed: {stderr}"));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let (staged, unstaged) = parse_porcelain_status(&raw);
    let untracked_count = unstaged.iter().filter(|e| e.status == "?").count();

    let total_ms = t.elapsed().as_millis();
    let msg = format!(
        "get_working_tree_status staged={} modified={} untracked={} total_ms={}",
        staged.len(),
        unstaged.len() - untracked_count,
        untracked_count,
        total_ms,
    );
    if total_ms > 2000 {
        warn!("[SLOW] {msg}");
    } else {
        info!("{msg}");
    }

    Ok(WorkingTreeStatus { staged, unstaged })
}

// ── Working tree file actions ────────────────────────────────────────────────

/// Stage a file (or untracked file) — `git add -- <path>`.
#[tauri::command]
async fn stage_file(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let out = git_async()
        .args(["add", "--", &file_path])
        .current_dir(&path)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    info!("stage_file: {file_path}");
    Ok(())
}

/// Unstage a file — `git restore --staged -- <path>`.
#[tauri::command]
async fn unstage_file(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let out = git_async()
        .args(["restore", "--staged", "--", &file_path])
        .current_dir(&path)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    info!("unstage_file: {file_path}");
    Ok(())
}

/// Discard working-tree changes for a tracked file — `git restore -- <path>`.
#[tauri::command]
async fn discard_changes(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let out = git_async()
        .args(["restore", "--", &file_path])
        .current_dir(&path)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    info!("discard_changes: {file_path}");
    Ok(())
}

/// Delete an untracked file from the filesystem.
#[tauri::command]
async fn delete_untracked(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let full = path.join(&file_path);
    std::fs::remove_file(&full)
        .map_err(|e| format!("Failed to delete {file_path}: {e}"))?;
    info!("delete_untracked: {file_path}");
    Ok(())
}

#[tauri::command]
async fn get_staged_diff(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let output = git_async()
        .args(["-C", &path_str, "diff", "--cached", "--no-color", "-M", "--", &file_path])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_unstaged_diff(
    tab_id: String,
    file_path: String,
    is_untracked: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let output = if is_untracked {
        let full = path.join(&file_path).to_string_lossy().to_string();
        // Use the platform null device: /dev/null on Unix, nul on Windows.
        let null_dev = if cfg!(windows) { "nul" } else { "/dev/null" };
        git_async()
            .args(["diff", "--no-index", "--no-color", "--", null_dev, &full])
            .output()
            .await
            .map_err(|e| e.to_string())?
    } else {
        git_async()
            .args(["-C", &path_str, "diff", "--no-color", "--", &file_path])
            .output()
            .await
            .map_err(|e| e.to_string())?
    };

    // exit 1 = diff exists (normal), 128 = git error
    if output.status.code() == Some(128) {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Open the diff for a specific file at a specific commit in the user's
/// configured external diff tool (`git difftool`).
/// Spawns detached so the UI is never blocked waiting for the tool to close.
#[tauri::command]
async fn open_diff_external(
    tab_id: String,
    oid: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let parent = format!("{}^", oid);
    let args = [
        "-C", &path_str,
        "difftool", "--no-prompt", "--tool=bc",
        &parent, &oid,
        "--", &file_path,
    ];
    info!("open_diff_external: git {}", args.join(" "));

    std::process::Command::new("git")
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Open the current working-tree diff for a file in Beyond Compare.
/// `staged = true`  → compare HEAD vs index  (`git difftool --cached`)
/// `staged = false` → compare index vs working tree (`git difftool`)
#[tauri::command]
async fn open_working_tree_diff_external(
    tab_id: String,
    file_path: String,
    staged: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let mut args = vec!["-C", &path_str, "difftool", "--no-prompt", "--tool=bc"];
    if staged {
        args.push("--cached");
    }
    args.extend_from_slice(&["--", &file_path]);

    info!("open_working_tree_diff_external: git {}", args.join(" "));

    std::process::Command::new("git")
        .args(&args)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Apply a patch string via `git apply`.
/// `reverse = true` → `git apply --reverse` (unstage a staged chunk).
/// Always uses `--cached` so only the index is touched, never the working tree.
#[tauri::command]
async fn apply_patch(
    tab_id: String,
    patch: String,
    reverse: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let mut args = vec!["-C", &path_str, "apply", "--cached"];
    if reverse {
        args.push("--reverse");
    }

    let mut child = git_async()
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    child.stdin.take().unwrap().write_all(patch.as_bytes()).await.map_err(|e| e.to_string())?;

    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

// ── Pull with rebase ─────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct PullLine {
    tab_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct PullDone {
    tab_id: String,
    success: bool,
}

#[tauri::command]
async fn pull_with_rebase(
    // When remote+branch are Some, passes them explicitly to git pull.
    // When None, uses the current branch's configured upstream.
    tab_id: String,
    rebase: bool,
    remote: Option<String>,
    branch: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    // --progress forces git to emit remote/receiving progress lines even when
    // stdout is not a TTY. Without it git stays silent until the operation
    // finishes, so the drawer shows "Starting…" for the entire network round-trip.
    let mut args = vec!["-C", &path_str, "pull", "--progress"];
    if rebase {
        args.push("--rebase");
        args.push("--autostash");
    }
    // Borrow remote/branch as &str so they live long enough for the args slice.
    let remote_str;
    let branch_str;
    if let (Some(r), Some(b)) = (&remote, &branch) {
        remote_str = r.as_str();
        branch_str = b.as_str();
        args.push(remote_str);
        args.push(branch_str);
        info!("pull rebase={rebase} {remote_str}/{branch_str}");
    } else {
        info!("pull rebase={rebase} current branch upstream");
    }

    let mut child = git_async()
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Stream stdout and stderr concurrently, emitting each line as an event.
    let emit_line = {
        let app = app.clone();
        let tab_id = tab_id.clone();
        move |line: String| {
            let _ = app.emit("pull:line", PullLine { tab_id: tab_id.clone(), line });
        }
    };
    let emit_line2 = emit_line.clone();

    let out_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emit_line(line);
        }
    });
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emit_line2(line);
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = tokio::join!(out_task, err_task);

    if status.success() {
        info!("pull_with_rebase succeeded");
    } else {
        warn!("pull_with_rebase failed with status: {}", status);
    }
    let _ = app.emit("pull:done", PullDone { tab_id, success: status.success() });

    Ok(())
}

// ── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: AppState = DashMap::new();
    tauri::Builder::default()
        .manage(state)
        .plugin({
            // Builder::new() ships with implicit Stdout + LogDir defaults; clear
            // them first so our explicit targets are the only ones active.
            let builder = tauri_plugin_log::Builder::new()
                .clear_targets()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("least-git".into()),
                    },
                ));
            // In dev builds also echo to stdout.
            #[cfg(debug_assertions)]
            let builder = builder.target(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Stdout,
            ));
            builder.build()
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            // Exclude DECORATIONS from saved/restored state: we manage decorations
            // via config (decorations:false on Windows) and never want a stale
            // "decorations:true" entry from a previous run to override that.
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Menu bar is macOS-only. On Windows the native menu bar appears as
            // a second title bar when decorations:false is set, so we skip it
            // entirely — keyboard shortcuts on Windows are handled in the frontend.
            // Belt-and-suspenders: programmatically disable decorations on Windows
            // in case the platform config merge didn't take effect.
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            #[cfg(target_os = "macos")]
            {
                let refresh_item = MenuItem::with_id(app, "refresh", "Refresh", true, Some("Cmd+R"))?;
                let branch_item = MenuItem::with_id(app, "branch", "Branch…", true, Some("Cmd+Shift+B"))?;
                let pull_item = MenuItem::with_id(app, "pull", "Pull…", true, Some("Cmd+Shift+P"))?;
                let repo_menu = Submenu::with_items(app, "Repository", true, &[&refresh_item, &branch_item, &pull_item])?;
                // macOS requires the app-name menu as the first entry or nothing renders.
                let app_menu = Submenu::with_items(
                    app,
                    app.package_info().name.clone(),
                    true,
                    &[
                        &PredefinedMenuItem::about(app, None, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, None)?,
                    ],
                )?;
                let menu = Menu::with_items(app, &[&app_menu, &repo_menu])?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if event.id() == "refresh" {
                        let _ = app.emit("menu:refresh", ());
                    } else if event.id() == "branch" {
                        let _ = app.emit("menu:branch", ());
                    } else if event.id() == "pull" {
                        let _ = app.emit("menu:pull", ());
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_repo,
            close_tab,
            open_diff_external,
            open_working_tree_diff_external,
            clear_detail_cache,
            load_commits,
            list_branches,
            create_branch,
            checkout_branch,
            get_commit_detail,
            get_file_diff,
            get_working_tree_status,
            get_staged_diff,
            get_unstaged_diff,
            apply_patch,
            stage_file,
            unstage_file,
            discard_changes,
            delete_untracked,
            pull_with_rebase,
            get_git_config_globals,
            set_git_config_global,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Global git config ─────────────────────────────────────────────────────────

/// Read multiple `--global` git config keys in one call.
/// Returns a map of key → value string, or null if the key is unset.
#[tauri::command]
async fn get_git_config_globals(
    keys: Vec<String>,
) -> Result<HashMap<String, Option<String>>, String> {
    let mut result = HashMap::new();
    for key in &keys {
        let output = git_async()
            .args(["config", "--global", "--get", key])
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let value = if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None // key not set
        };
        result.insert(key.clone(), value);
    }
    Ok(result)
}

/// Set or unset a `--global` git config key.
/// Pass `value: null` to unset; otherwise sets the key to the given string.
#[tauri::command]
async fn set_git_config_global(key: String, value: Option<String>) -> Result<(), String> {
    let status = match &value {
        Some(val) => git_async()
            .args(["config", "--global", &key, val])
            .status()
            .await
            .map_err(|e| e.to_string())?,
        None => git_async()
            .args(["config", "--global", "--unset", &key])
            .status()
            .await
            .map_err(|e| e.to_string())?,
    };
    if !status.success() {
        // Exit code 5 means the key was already absent — treat as success.
        if status.code() == Some(5) {
            return Ok(());
        }
        return Err(format!("git config exited with code {:?}", status.code()));
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── split_message ────────────────────────────────────────────────────────

    #[test]
    fn split_message_single_line() {
        let (summary, body) = split_message(b"Fix the bug");
        assert_eq!(summary, "Fix the bug");
        assert_eq!(body, "");
    }

    #[test]
    fn split_message_with_body() {
        let (summary, body) = split_message(b"Fix the bug\n\nMore details here.\nAnd another line.");
        assert_eq!(summary, "Fix the bug");
        assert_eq!(body, "More details here.\nAnd another line.");
    }

    #[test]
    fn split_message_trims_whitespace() {
        let (summary, body) = split_message(b"  Fix the bug  \n\n  Body here.  ");
        assert_eq!(summary, "Fix the bug");
        assert_eq!(body, "Body here.");
    }

    #[test]
    fn split_message_empty() {
        let (summary, body) = split_message(b"");
        assert_eq!(summary, "");
        assert_eq!(body, "");
    }

    #[test]
    fn split_message_only_newline() {
        let (summary, body) = split_message(b"\n");
        assert_eq!(summary, "");
        assert_eq!(body, "");
    }

    // ── parse_branches ───────────────────────────────────────────────────────

    #[test]
    fn parse_branches_main_sorted_first() {
        let raw = " main\n zebra\n alpha\n";
        let branches = parse_branches(raw);
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, ["main", "alpha", "zebra"]);
    }

    #[test]
    fn parse_branches_master_sorted_first() {
        let raw = " zebra\n master\n alpha\n";
        let branches = parse_branches(raw);
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, ["master", "alpha", "zebra"]);
    }

    #[test]
    fn parse_branches_marks_head() {
        let raw = " main\n*feature/foo\n";
        let branches = parse_branches(raw);
        let head: Vec<&str> = branches.iter().filter(|b| b.is_head).map(|b| b.name.as_str()).collect();
        assert_eq!(head, ["feature/foo"]);
        assert!(!branches.iter().find(|b| b.name == "main").unwrap().is_head);
    }

    #[test]
    fn parse_branches_empty_input() {
        assert!(parse_branches("").is_empty());
    }

    #[test]
    fn parse_branches_ignores_blank_lines() {
        let raw = " main\n\n feature/bar\n";
        let branches = parse_branches(raw);
        assert_eq!(branches.len(), 2);
    }

    #[test]
    fn parse_branches_long_names() {
        let raw = "*users/jack/my-feature\n users/alice/other\n main\n";
        let branches = parse_branches(raw);
        assert_eq!(branches[0].name, "main");
        assert_eq!(branches[1].name, "users/alice/other");
        assert_eq!(branches[2].name, "users/jack/my-feature");
        assert!(branches[2].is_head);
    }

    // ── parse_name_status ────────────────────────────────────────────────────

    #[test]
    fn parse_name_status_modified() {
        let out = "M\tsrc/main.rs\n";
        let entries = parse_name_status(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].status, "M");
        assert_eq!(entries[0].path, "src/main.rs");
        assert!(entries[0].old_path.is_none());
    }

    #[test]
    fn parse_name_status_added_and_deleted() {
        let out = "A\tnew_file.rs\nD\told_file.rs\n";
        let entries = parse_name_status(out);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].status, "A");
        assert_eq!(entries[1].status, "D");
    }

    #[test]
    fn parse_name_status_rename() {
        let out = "R100\told/path.rs\tnew/path.rs\n";
        let entries = parse_name_status(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].status, "R");
        assert_eq!(entries[0].path, "new/path.rs");
        assert_eq!(entries[0].old_path.as_deref(), Some("old/path.rs"));
    }

    #[test]
    fn parse_name_status_copy() {
        let out = "C100\tsrc/original.rs\tsrc/copy.rs\n";
        let entries = parse_name_status(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].status, "C");
        assert_eq!(entries[0].path, "src/copy.rs");
        assert_eq!(entries[0].old_path.as_deref(), Some("src/original.rs"));
    }

    #[test]
    fn parse_name_status_spaces_in_path() {
        let out = "M\tsrc/my file with spaces.rs\n";
        let entries = parse_name_status(out);
        assert_eq!(entries[0].path, "src/my file with spaces.rs");
    }

    #[test]
    fn parse_name_status_empty() {
        assert!(parse_name_status("").is_empty());
    }

    #[test]
    fn parse_name_status_skips_malformed_lines() {
        // A line with no tab should be silently skipped
        let out = "not-a-valid-line\nM\tvalid.rs\n";
        let entries = parse_name_status(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "valid.rs");
    }

    #[test]
    fn parse_name_status_multiple_files() {
        let out = "M\tsrc/a.rs\nA\tsrc/b.rs\nD\tsrc/c.rs\nR90\told.rs\tnew.rs\n";
        let entries = parse_name_status(out);
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[3].old_path.as_deref(), Some("old.rs"));
    }

    // ── parse_porcelain_status ───────────────────────────────────────────────

    #[test]
    fn porcelain_untracked() {
        // "?? path\0" → unstaged with status "?"
        let raw = "?? new_file.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty());
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].status, "?");
        assert_eq!(unstaged[0].path, "new_file.rs");
    }

    #[test]
    fn porcelain_staged_modified() {
        // "M  path\0" → staged M, worktree clean
        let raw = "M  src/lib.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status, "M");
        assert_eq!(staged[0].path, "src/lib.rs");
        assert!(unstaged.is_empty());
    }

    #[test]
    fn porcelain_worktree_modified() {
        // " M path\0" → index clean, worktree modified
        let raw = " M src/lib.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty());
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].status, "M");
    }

    #[test]
    fn porcelain_both_modified() {
        // "MM path\0" → staged M and worktree M
        let raw = "MM src/lib.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status, "M");
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].status, "M");
    }

    #[test]
    fn porcelain_staged_added() {
        let raw = "A  new.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status, "A");
        assert!(unstaged.is_empty());
    }

    #[test]
    fn porcelain_staged_deleted() {
        let raw = "D  gone.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status, "D");
        assert!(unstaged.is_empty());
    }

    #[test]
    fn porcelain_rename_in_index() {
        // "R  new\0old\0" — rename in index
        let raw = "R  new.rs\0old.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status, "R");
        assert_eq!(staged[0].path, "new.rs");
        assert_eq!(staged[0].old_path.as_deref(), Some("old.rs"));
        assert!(unstaged.is_empty());
    }

    #[test]
    fn porcelain_mixed_batch() {
        // staged A, worktree M untracked
        let raw = "A  added.rs\0 M modified.rs\0?? untracked.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].path, "added.rs");
        assert_eq!(unstaged.len(), 2);
        let untracked: Vec<_> = unstaged.iter().filter(|e| e.status == "?").collect();
        let modified: Vec<_> = unstaged.iter().filter(|e| e.status == "M").collect();
        assert_eq!(untracked.len(), 1);
        assert_eq!(modified.len(), 1);
    }

    #[test]
    fn porcelain_empty_input() {
        let (staged, unstaged) = parse_porcelain_status("");
        assert!(staged.is_empty());
        assert!(unstaged.is_empty());
    }

    #[test]
    fn porcelain_skips_short_records() {
        // Records shorter than 4 bytes are silently skipped
        let raw = "XY\0?? valid.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty());
        assert_eq!(unstaged.len(), 1);
    }
}
