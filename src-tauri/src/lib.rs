use dashmap::DashMap;
use gix::bstr::ByteSlice;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::State;

// ── Shared state ────────────────────────────────────────────────────────────

struct RepoEntry {
    path: PathBuf,
    name: String,
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

    state.insert(id.clone(), RepoEntry { path: canonical, name: name.clone() });

    Ok(TabInfo { id: id.clone(), path: id, name })
}

#[tauri::command]
fn close_tab(tab_id: String, state: State<'_, AppState>) {
    state.remove(&tab_id);
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

    let branch_out = Command::new("git")
        .args(["-C", &path_str, "branch", "--format=%(refname:short)"])
        .output()
        .map_err(|e| e.to_string())?;

    let head_out = Command::new("git")
        .args(["-C", &path_str, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;

    let current = String::from_utf8_lossy(&head_out.stdout).trim().to_string();

    let mut branches: Vec<BranchInfo> = String::from_utf8_lossy(&branch_out.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|name| BranchInfo {
            name: name.to_string(),
            is_head: name == current,
        })
        .collect();
    branches.sort_unstable_by(|a, b| a.name.cmp(&b.name));

    Ok(branches)
}

#[tauri::command]
fn checkout_branch(
    tab_id: String,
    branch: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let output = Command::new("git")
        .args(["-C", &path_str, "checkout", &branch])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

#[tauri::command]
fn get_commit_detail(
    tab_id: String,
    oid: String,
    state: State<'_, AppState>,
) -> Result<CommitDetail, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    // Metadata via gix
    let repo = gix::open(&path).map_err(|e| e.to_string())?;
    let commit_id = gix::ObjectId::from_hex(oid.trim().as_bytes())
        .map_err(|e| format!("Invalid OID: {e}"))?;
    let object = repo.find_object(commit_id).map_err(|e| e.to_string())?;
    let commit = object
        .try_into_commit()
        .map_err(|e| format!("not a commit: {e:?}"))?;
    let decoded = commit.decode().map_err(|e| e.to_string())?;

    let summary_end = decoded.message.find_byte(b'\n').unwrap_or(decoded.message.len());
    let summary = decoded.message[..summary_end].to_str_lossy().trim().to_string();
    let body = if summary_end < decoded.message.len() {
        decoded.message[summary_end..].to_str_lossy().trim().to_string()
    } else {
        String::new()
    };

    // Changed files via git CLI
    let files_out = Command::new("git")
        .args([
            "-C", &path_str,
            "diff-tree", "--no-commit-id", "-r", "--name-status", "-M", &oid,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    for line in String::from_utf8_lossy(&files_out.stdout).lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let status = parts[0][..1].to_string(); // first char: M/A/D/R/C
        let (file_path, old_path) = if (status == "R" || status == "C") && parts.len() == 3 {
            (parts[2].to_string(), Some(parts[1].to_string()))
        } else {
            (parts[1].to_string(), None)
        };
        files.push(ChangedFile { path: file_path, old_path, status });
    }

    Ok(CommitDetail {
        oid,
        summary,
        body,
        author_name: decoded.author.name.to_str_lossy().to_string(),
        author_email: decoded.author.email.to_str_lossy().to_string(),
        timestamp: decoded.author.time.seconds,
        files,
    })
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
    let output = Command::new("git")
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
fn get_working_tree_status(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let staged_out = Command::new("git")
        .args(["-C", &path_str, "diff", "--cached", "--name-status", "-M"])
        .output()
        .map_err(|e| e.to_string())?;

    let unstaged_out = Command::new("git")
        .args(["-C", &path_str, "diff", "--name-status"])
        .output()
        .map_err(|e| e.to_string())?;

    let untracked_out = Command::new("git")
        .args(["-C", &path_str, "ls-files", "--others", "--exclude-standard"])
        .output()
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

    let output = Command::new("git")
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
        Command::new("git")
            .args(["diff", "--no-index", "--no-color", "--", "/dev/null", &full])
            .output()
            .map_err(|e| e.to_string())?
    } else {
        Command::new("git")
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

// ── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: AppState = DashMap::new();
    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_repo,
            close_tab,
            load_commits,
            list_branches,
            checkout_branch,
            get_commit_detail,
            get_file_diff,
            get_working_tree_status,
            get_staged_diff,
            get_unstaged_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
