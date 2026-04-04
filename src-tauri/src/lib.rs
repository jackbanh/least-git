use dashmap::DashMap;
use gix::bstr::ByteSlice;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, State};

/// Spawn a synchronous git process. On Windows, `CREATE_NO_WINDOW` prevents a
/// console window from flashing when the app is launched as a GUI executable.
fn git() -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Same as `git()` but returns a `tokio::process::Command` for async callers.
fn git_async() -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new("git");
    #[cfg(windows)]
    {
        use tokio::process::windows::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

// ── Shared state ────────────────────────────────────────────────────────────

struct RepoEntry {
    path: PathBuf,
    name: String,
    /// Caches CommitDetail by OID. Cleared on refresh (bumpListKey → close/reopen tab).
    detail_cache: Mutex<HashMap<String, CommitDetail>>,
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
fn open_repo(path: String, state: State<'_, AppState>) -> Result<TabInfo, String> {
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

    gix::open(&canonical).map_err(|e| format!("Not a git repository: {e}"))?;

    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo")
        .to_string();

    state.insert(id.clone(), RepoEntry { path: canonical, name: name.clone(), detail_cache: Mutex::new(HashMap::new()) });

    Ok(TabInfo { id: id.clone(), path: id, name })
}

#[tauri::command]
fn close_tab(tab_id: String, state: State<'_, AppState>) {
    state.remove(&tab_id);
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
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<CommitInfo>, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let repo = gix::open(&path).map_err(|e| e.to_string())?;
    let head_id = repo.head_id().map_err(|e| e.to_string())?;
    let walk = head_id
        .ancestors()
        .first_parent_only()
        .all()
        .map_err(|e| e.to_string())?;

    let mut commits = Vec::with_capacity(limit.min(100));
    for info in walk.skip(offset).take(limit) {
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

        commits.push(CommitInfo {
            oid: oid_str,
            short_oid,
            summary,
            author_name: decoded.author.name.to_str_lossy().to_string(),
            author_email: decoded.author.email.to_str_lossy().to_string(),
            timestamp: decoded.author.time.seconds,
        });
    }

    Ok(commits)
}

#[tauri::command]
fn list_branches(tab_id: String, state: State<'_, AppState>) -> Result<Vec<BranchInfo>, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    // %(HEAD) is '*' for the current branch, ' ' for all others — one spawn instead of two.
    let out = git()
        .args(["-C", &path_str, "branch", "--format=%(HEAD)%(refname:short)"])
        .output()
        .map_err(|e| e.to_string())?;

    let raw = String::from_utf8_lossy(&out.stdout).to_string();
    Ok(parse_branches(&raw))
}

#[tauri::command]
fn checkout_branch(
    tab_id: String,
    branch: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let output = git()
        .args(["-C", &path_str, "checkout", &branch])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

#[tauri::command]
async fn get_commit_detail(
    tab_id: String,
    oid: String,
    state: State<'_, AppState>,
) -> Result<CommitDetail, String> {
    // Cache hit — return immediately without spawning any processes.
    {
        let entry = state.get(&tab_id).ok_or_else(|| format!("Tab not found: {tab_id}"))?;
        let cached = entry.detail_cache.lock().unwrap().get(&oid).cloned();
        if let Some(detail) = cached {
            return Ok(detail);
        }
    }

    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();
    let oid_clone = oid.clone();

    // Run gix metadata lookup and git diff-tree concurrently.
    let meta_fut = tokio::task::spawn_blocking({
        let path = path.clone();
        let oid = oid.clone();
        move || -> Result<(String, String, String, String, i64), String> {
            let repo = gix::open(&path).map_err(|e| e.to_string())?;
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
            ))
        }
    });

    let files_fut = git_async()
        .args(["-C", &path_str, "diff-tree", "--no-commit-id", "-r", "--name-status", "-M", &oid_clone])
        .output();

    let (meta_res, files_out) = tokio::try_join!(
        async { meta_fut.await.map_err(|e: tokio::task::JoinError| e.to_string())? },
        async { files_fut.await.map_err(|e| e.to_string()) }
    )?;

    let (summary, body, author_name, author_email, timestamp) = meta_res;
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

    let detail = CommitDetail { oid: oid.clone(), summary, body, author_name, author_email, timestamp, files };

    // Store in cache.
    if let Some(entry) = state.get(&tab_id) {
        entry.detail_cache.lock().unwrap().insert(oid, detail.clone());
    }

    Ok(detail)
}

#[tauri::command]
fn get_file_diff(
    tab_id: String,
    oid: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    // --root handles initial commits (diffs against empty tree)
    let output = git()
        .args([
            "-C", &path_str,
            "diff-tree", "--root", "--no-commit-id", "-r", "-p", "--no-color", "-M",
            &oid, "--", &file_path,
        ])
        .output()
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

fn parse_branches(raw: &str) -> Vec<BranchInfo> {
    let mut branches: Vec<BranchInfo> = raw
        .lines()
        .filter(|l| l.len() > 1)
        .map(|line| {
            let is_head = line.starts_with('*');
            BranchInfo { name: line[1..].to_string(), is_head }
        })
        .collect();
    branches.sort_unstable_by(|a, b| a.name.cmp(&b.name));
    branches
}

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
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let staged_fut = git_async()
        .args(["-C", &path_str, "diff", "--cached", "--name-status", "-M"])
        .output();
    let unstaged_fut = git_async()
        .args(["-C", &path_str, "diff", "--name-status"])
        .output();
    let untracked_fut = git_async()
        .args(["-C", &path_str, "ls-files", "--others", "--exclude-standard"])
        .output();

    let (staged_out, unstaged_out, untracked_out) =
        tokio::try_join!(staged_fut, unstaged_fut, untracked_fut)
            .map_err(|e| e.to_string())?;

    let mut unstaged = parse_name_status(&String::from_utf8_lossy(&unstaged_out.stdout));
    for line in String::from_utf8_lossy(&untracked_out.stdout).lines() {
        if !line.is_empty() {
            unstaged.push(StatusEntry { path: line.to_string(), old_path: None, status: "?".to_string() });
        }
    }

    Ok(WorkingTreeStatus {
        staged: parse_name_status(&String::from_utf8_lossy(&staged_out.stdout)),
        unstaged,
    })
}

#[tauri::command]
fn get_staged_diff(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let output = git()
        .args(["-C", &path_str, "diff", "--cached", "--no-color", "-M", "--", &file_path])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn get_unstaged_diff(
    tab_id: String,
    file_path: String,
    is_untracked: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let output = if is_untracked {
        let full = path.join(&file_path).to_string_lossy().to_string();
        git()
            .args(["diff", "--no-index", "--no-color", "--", "/dev/null", &full])
            .output()
            .map_err(|e| e.to_string())?
    } else {
        git()
            .args(["-C", &path_str, "diff", "--no-color", "--", &file_path])
            .output()
            .map_err(|e| e.to_string())?
    };

    // exit 1 = diff exists (normal), 128 = git error
    if output.status.code() == Some(128) {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Apply a patch string via `git apply`.
/// `reverse = true` → `git apply --reverse` (unstage a staged chunk).
/// Always uses `--cached` so only the index is touched, never the working tree.
#[tauri::command]
fn apply_patch(
    tab_id: String,
    patch: String,
    reverse: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let mut args = vec!["-C", &path_str, "apply", "--cached"];
    if reverse {
        args.push("--reverse");
    }

    let mut child = git()
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    use std::io::Write;
    child.stdin.take().unwrap().write_all(patch.as_bytes()).map_err(|e| e.to_string())?;

    let out = child.wait_with_output().map_err(|e| e.to_string())?;
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
    tab_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    // Detect whether origin has main or master and use that branch.
    let probe = git()
        .args(["-C", &path_str, "ls-remote", "--heads", "origin", "main", "master"])
        .output()
        .map_err(|e| e.to_string())?;
    let probe_out = String::from_utf8_lossy(&probe.stdout);
    let branch = if probe_out.contains("refs/heads/main") { "main" } else { "master" };

    let mut child = git_async()
        .args(["-C", &path_str, "pull", "--rebase", "--autostash", "origin", branch])
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

    let _ = app.emit("pull:done", PullDone { tab_id, success: status.success() });

    Ok(())
}

// ── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: AppState = DashMap::new();
    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let refresh_item = MenuItem::with_id(
                app,
                "refresh",
                "Refresh",
                true,
                if cfg!(target_os = "macos") { Some("Cmd+R") } else { Some("F5") },
            )?;
            let repo_menu = Submenu::with_items(app, "Repository", true, &[&refresh_item])?;

            // macOS requires the app-name menu as the first entry or nothing renders.
            #[cfg(target_os = "macos")]
            let menu = {
                let app_menu = Submenu::with_items(
                    app,
                    app.package_info().name.clone(),
                    true,
                    &[
                        &PredefinedMenuItem::about(app, None, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, None)?,
                    ],
                )?;
                Menu::with_items(app, &[&app_menu, &repo_menu])?
            };

            #[cfg(not(target_os = "macos"))]
            let menu = Menu::with_items(app, &[&repo_menu])?;

            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id() == "refresh" {
                    let _ = app.emit("menu:refresh", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_repo,
            close_tab,
            clear_detail_cache,
            load_commits,
            list_branches,
            checkout_branch,
            get_commit_detail,
            get_file_diff,
            get_working_tree_status,
            get_staged_diff,
            get_unstaged_diff,
            apply_patch,
            pull_with_rebase,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    fn parse_branches_sorted_alphabetically() {
        let raw = " main\n zebra\n alpha\n";
        let branches = parse_branches(raw);
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, ["alpha", "main", "zebra"]);
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
}
