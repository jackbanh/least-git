pub mod commands;

use commands::{branches, commits, config, external, working_tree};

use dashmap::DashMap;
use log::{info, warn};
use notify_debouncer_mini::new_debouncer;
use notify_debouncer_mini::notify::RecursiveMode;
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
pub(crate) fn git_async() -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new("git");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

// ── Shared state ─────────────────────────────────────────────────────────────

pub struct RepoEntry {
    pub path: PathBuf,
    pub name: String,
    /// Caches CommitDetail by OID. Cleared on refresh (bumpListKey → close/reopen tab).
    pub detail_cache: Mutex<HashMap<String, CommitDetail>>,
    /// Keeps the filesystem watcher alive for the lifetime of the tab.
    pub _watcher: Mutex<Option<notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
}

pub type AppState = DashMap<String, RepoEntry>;

pub(crate) fn get_repo_path(tab_id: &str, state: &State<'_, AppState>) -> Result<PathBuf, String> {
    state
        .get(tab_id)
        .map(|e| e.path.clone())
        .ok_or_else(|| format!("Tab not found: {tab_id}"))
}

// ── Serialisable types ────────────────────────────────────────────────────────

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

// ── Streaming event payloads (used by checkout_branch and pull_with_rebase) ──

#[derive(Clone, Serialize)]
pub(crate) struct PullLine {
    pub(crate) tab_id: String,
    pub(crate) line: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct PullDone {
    pub(crate) tab_id: String,
    pub(crate) success: bool,
}

// ── Watcher event classification ─────────────────────────────────────────────

/// Classify a debounced batch of watcher paths into what the frontend needs to
/// refresh.  Returns `Some("refs")` if any path looks like a branch/HEAD change,
/// `Some("index")` for a staging-area-only change, or `None` if all paths are
/// noise (lock files, `COMMIT_EDITMSG`, etc.).
///
/// Lock files (`.lock` extension) are always filtered first — they are
/// transient and always paired with a real file write that fires its own event.
///
/// `"refs"` supersedes `"index"`: a commit touches both `refs/` and `index`,
/// but a full commit-list refresh already covers the working-tree status.
pub(crate) fn classify_watcher_paths(paths: &[&std::path::Path]) -> Option<&'static str> {
    let relevant: Vec<_> = paths
        .iter()
        .filter(|p| p.extension().is_none_or(|e| e != "lock"))
        .collect();

    if relevant.is_empty() {
        return None;
    }

    let has_refs = relevant.iter().any(|p| {
        let name = p.file_name().unwrap_or_default();
        name == "HEAD"
            || name == "packed-refs"
            || p.components().any(|c| c.as_os_str() == "refs")
    });

    let has_index = relevant
        .iter()
        .any(|p| p.file_name().unwrap_or_default() == "index");

    if has_refs {
        Some("refs")
    } else if has_index {
        Some("index")
    } else {
        None
    }
}

// ── Repo lifecycle commands ───────────────────────────────────────────────────

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
                let paths: Vec<&std::path::Path> =
                    events.iter().map(|ev| ev.path.as_path()).collect();
                let Some(kind) = classify_watcher_paths(&paths) else {
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
                    warn!("failed to watch {}: {e}", git_dir.display());
                }
                Some(d)
            }
            Err(e) => {
                warn!("failed to create watcher for {}: {e}", git_dir.display());
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

// ── Pull with rebase ──────────────────────────────────────────────────────────

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
        warn!("pull_with_rebase failed with status: {status}");
    }
    let _ = app.emit("pull:done", PullDone { tab_id, success: status.success() });

    Ok(())
}

// ── App entry point ───────────────────────────────────────────────────────────

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
            clear_detail_cache,
            commits::load_commits,
            commits::get_commit_detail,
            commits::get_file_diff,
            branches::list_branches,
            branches::create_branch,
            branches::checkout_branch,
            working_tree::get_working_tree_status,
            working_tree::stage_file,
            working_tree::unstage_file,
            working_tree::discard_changes,
            working_tree::delete_untracked,
            working_tree::get_staged_diff,
            working_tree::get_unstaged_diff,
            working_tree::apply_patch,
            external::open_diff_external,
            external::open_working_tree_diff_external,
            config::get_git_config_globals,
            config::set_git_config_global,
            pull_with_rebase,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // ── classify_watcher_paths ───────────────────────────────────────────────
    // These test the event-classification logic that determines what the
    // frontend is asked to refresh.  Getting the priority wrong causes either
    // missed refreshes or unnecessary full reloads.

    #[test]
    fn watcher_empty_paths_is_none() {
        assert_eq!(classify_watcher_paths(&[]), None);
    }

    #[test]
    fn watcher_only_lock_files_is_none() {
        // Lock files are transient; they must be filtered before classification.
        let paths = [
            Path::new(".git/index.lock"),
            Path::new(".git/HEAD.lock"),
        ];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), None);
    }

    #[test]
    fn watcher_head_change_is_refs() {
        let paths = [Path::new(".git/HEAD")];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), Some("refs"));
    }

    #[test]
    fn watcher_packed_refs_is_refs() {
        let paths = [Path::new(".git/packed-refs")];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), Some("refs"));
    }

    #[test]
    fn watcher_refs_dir_is_refs() {
        // Any path with a "refs" path component (e.g. a branch ref file) must
        // trigger a refs refresh.
        let paths = [Path::new(".git/refs/heads/main")];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), Some("refs"));
    }

    #[test]
    fn watcher_index_only_is_index() {
        // Staging a file touches only the index — should trigger an index refresh.
        let paths = [Path::new(".git/index")];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), Some("index"));
    }

    #[test]
    fn watcher_refs_supersedes_index() {
        // A commit touches both refs/ and index.  "refs" must win so the full
        // commit list is refreshed rather than just the working-tree status.
        let paths = [
            Path::new(".git/refs/heads/main"),
            Path::new(".git/index"),
        ];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), Some("refs"));
    }

    #[test]
    fn watcher_lock_filtered_before_classification() {
        // index.lock must be removed before classification; if it weren't, a
        // plain lock-file flush would incorrectly emit an "index" refresh.
        let paths = [Path::new(".git/index.lock")];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), None);
    }

    #[test]
    fn watcher_head_lock_then_real_head() {
        // A real HEAD write is always accompanied by HEAD.lock.  Only the real
        // HEAD should be counted; the lock must be ignored.
        let paths = [
            Path::new(".git/HEAD.lock"),
            Path::new(".git/HEAD"),
        ];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), Some("refs"));
    }

    #[test]
    fn watcher_unrelated_file_is_none() {
        // Files like COMMIT_EDITMSG or MERGE_MSG are not actionable.
        let paths = [
            Path::new(".git/COMMIT_EDITMSG"),
            Path::new(".git/MERGE_MSG"),
        ];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), None);
    }

    #[test]
    fn watcher_index_with_lock_is_index() {
        // Real index write arrives alongside its lock file; the lock must be
        // stripped but the real index should still produce "index".
        let paths = [
            Path::new(".git/index.lock"),
            Path::new(".git/index"),
        ];
        let refs: Vec<_> = paths.iter().map(|p| *p).collect();
        assert_eq!(classify_watcher_paths(&refs), Some("index"));
    }
}
