use crate::{git_async, get_repo_path, AppState, StatusEntry, WorkingTreeStatus};
use log::{info, warn};
use tauri::State;

/// Parse `git status --porcelain=v1 -z` output into (staged, unstaged) lists.
///
/// With `-z` the stream is NUL-terminated: `"XY path\0"` for ordinary entries and
/// `"XY new\0old\0"` for renames (only possible without `--no-renames`, kept for
/// safety). `X` = index status, `Y` = worktree status; `' '` means clean, `'?'`
/// means untracked. Untracked entries (`??`) go into `unstaged`.
pub(crate) fn parse_porcelain_status(raw: &str) -> (Vec<StatusEntry>, Vec<StatusEntry>) {
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
            iter.next().map(ToString::to_string)
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

#[tauri::command]
pub async fn get_working_tree_status(
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

/// Stage a file (or untracked file) — `git add -- <path>`.
#[tauri::command]
pub async fn stage_file(
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
pub async fn unstage_file(
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
pub async fn discard_changes(
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
pub async fn delete_untracked(
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
pub async fn get_staged_diff(
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
pub async fn get_unstaged_diff(
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

/// Apply a patch string via `git apply`.
/// `reverse = true` → `git apply --reverse` (unstage a staged chunk).
/// Always uses `--cached` so only the index is touched, never the working tree.
#[tauri::command]
pub async fn apply_patch(
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn porcelain_worktree_deleted() {
        // " D path\0" — file deleted in the working tree, index still has it.
        // This goes into unstaged (not staged).
        let raw = " D src/gone.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty());
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].status, "D");
        assert_eq!(unstaged[0].path, "src/gone.rs");
    }

    #[test]
    fn porcelain_staged_deleted_and_worktree_deleted() {
        // "DD path\0" — deleted both in index and working tree (unusual but valid).
        let raw = "DD src/gone.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status, "D");
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].status, "D");
    }

    #[test]
    fn porcelain_copy_in_index() {
        // "C  new\0old\0" — file copied in the index (rare but git can produce it).
        let raw = "C  new_copy.rs\0original.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status, "C");
        assert_eq!(staged[0].path, "new_copy.rs");
        assert_eq!(staged[0].old_path.as_deref(), Some("original.rs"));
        assert!(unstaged.is_empty());
    }

    #[test]
    fn porcelain_path_with_spaces() {
        // Paths containing spaces must be preserved verbatim.
        let raw = " M src/my component.tsx\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty());
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].path, "src/my component.tsx");
    }

    #[test]
    fn porcelain_rename_then_worktree_modified() {
        // "RM new\0old\0" — file was renamed in the index AND further modified in
        // the working tree.  Both a staged rename and an unstaged modification
        // should be emitted, and the rename's old_path should be populated.
        let raw = "RM new.rs\0old.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].status, "R");
        assert_eq!(staged[0].path, "new.rs");
        assert_eq!(staged[0].old_path.as_deref(), Some("old.rs"));
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].status, "M");
        assert_eq!(unstaged[0].path, "new.rs");
    }

    #[test]
    fn porcelain_untracked_does_not_pollute_staged() {
        // Untracked entries ("??") must never appear in the staged list.
        let raw = "?? untracked.rs\0";
        let (staged, _unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty());
    }

    #[test]
    fn porcelain_multiple_renames_sequential() {
        // Two consecutive rename records — the NUL-separated old-path record must
        // be consumed for each rename so the iterator doesn't drift out of sync.
        let raw = "R  b.rs\0a.rs\0R  d.rs\0c.rs\0";
        let (staged, _unstaged) = parse_porcelain_status(raw);
        assert_eq!(staged.len(), 2);
        assert_eq!(staged[0].path, "b.rs");
        assert_eq!(staged[0].old_path.as_deref(), Some("a.rs"));
        assert_eq!(staged[1].path, "d.rs");
        assert_eq!(staged[1].old_path.as_deref(), Some("c.rs"));
    }
}
