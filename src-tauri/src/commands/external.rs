use crate::{get_repo_path, AppState};
use log::info;
use tauri::State;

/// Open the diff for a specific file at a specific commit in the user's
/// configured external diff tool (`git difftool`).
/// Spawns detached so the UI is never blocked waiting for the tool to close.
#[tauri::command]
pub async fn open_diff_external(
    tab_id: String,
    oid: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let parent = format!("{oid}^");
    let args = [
        "-C", &path_str,
        "difftool", "--no-prompt", "--tool=bc",
        &parent, &oid,
        "--", &file_path,
    ];
    info!("open_diff_external: git {}", args.join(" "));

    crate::git_sync()
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Open a conflicted file in Beyond Compare's three-way merge mode.
/// Runs `git mergetool --no-prompt --tool=bc -- file_path` detached.
#[tauri::command]
pub async fn open_mergetool_external(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let args = ["-C", &path_str, "mergetool", "--no-prompt", "--tool=bc", "--", &file_path];
    info!("open_mergetool_external: git {}", args.join(" "));

    crate::git_sync()
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Open the current working-tree diff for a file in Beyond Compare.
/// `staged = true`  → compare HEAD vs index  (`git difftool --cached`)
/// `staged = false` → compare index vs working tree (`git difftool`)
#[tauri::command]
pub async fn open_working_tree_diff_external(
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

    crate::git_sync()
        .args(&args)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}
