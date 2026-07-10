use crate::{git_async, get_repo_path, AppState, StatusEntry, WorkingTreeStatus};
use gix::bstr::ByteSlice;
use log::{info, warn};
use serde::Serialize;
use std::path::Path;
use tauri::State;

/// The 6 XY pairs that represent active merge conflicts requiring user resolution.
/// `DD` (both deleted) is excluded — git auto-resolves it and there's nothing to merge.
fn is_conflict_xy(x: char, y: char) -> bool {
    matches!((x, y), ('U','U') | ('A','A') | ('A','U') | ('U','A') | ('D','U') | ('U','D'))
}

/// Parse `git status --porcelain=v1 -z` output into (staged, unstaged) lists.
///
/// With `-z` the stream is NUL-terminated: `"XY path\0"` for ordinary entries and
/// `"XY new\0old\0"` for renames (only possible without `--no-renames`, kept for
/// safety). `X` = index status, `Y` = worktree status; `' '` means clean, `'?'`
/// means untracked. Untracked entries (`??`) go into `unstaged`.
/// Conflict entries appear only in `unstaged` with `is_conflict: true`.
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
            unstaged.push(StatusEntry { path, old_path: None, status: "?".to_string(), is_conflict: false });
        } else if is_conflict_xy(x, y) {
            // Merge conflict — appears only in unstaged so it shows once in the UI.
            // Status "U" is used for all conflict types as a sentinel the UI can style.
            unstaged.push(StatusEntry { path, old_path: None, status: "U".to_string(), is_conflict: true });
        } else {
            if x != ' ' && x != '?' {
                staged.push(StatusEntry {
                    path: path.clone(),
                    old_path: old_path.clone(),
                    status: x.to_string(),
                    is_conflict: false,
                });
            }
            if y != ' ' && y != '?' {
                unstaged.push(StatusEntry { path, old_path: None, status: y.to_string(), is_conflict: false });
            }
        }
    }
    (staged, unstaged)
}

// ── Conflict resolution helpers ───────────────────────────────────────────────

#[derive(Serialize)]
pub struct ConflictBranchInfo {
    pub local: String,
    pub incoming: String,
}

fn read_head_branch(git_dir: &Path) -> String {
    std::fs::read_to_string(git_dir.join("HEAD"))
        .ok()
        .and_then(|s| s.trim().strip_prefix("ref: refs/heads/").map(str::to_string))
        .unwrap_or_else(|| "HEAD".to_string())
}

fn resolve_sha_to_local_branch(repo_path: &Path, sha: &str) -> Option<String> {
    let repo = gix::open(repo_path).ok()?;
    let sha = sha.trim();
    repo.references().ok()?
        .local_branches()
        .ok()?
        .filter_map(Result::ok)
        .find_map(|mut r| {
            let id = r.peel_to_id_in_place().ok()?.to_string();
            (id.starts_with(sha) || sha.starts_with(&id[..7.min(id.len())]))
                .then(|| r.name().shorten().to_str_lossy().into_owned())
        })
}

fn read_merge_incoming(git_dir: &Path) -> String {
    std::fs::read_to_string(git_dir.join("MERGE_MSG"))
        .ok()
        .and_then(|msg| {
            let line = msg.lines().next()?;
            // "Merge branch 'foo'" / "Merge branch 'foo' into 'bar'"
            if let Some(rest) = line.strip_prefix("Merge branch '") {
                return rest.split('\'').next().map(str::to_string);
            }
            // "Merge remote-tracking branch 'origin/foo'"
            if let Some(rest) = line.strip_prefix("Merge remote-tracking branch '") {
                return rest.split('\'').next().map(str::to_string);
            }
            None
        })
        .unwrap_or_else(|| "incoming".to_string())
}

fn read_rebase_branches(repo_path: &Path, git_dir: &Path) -> (String, String) {
    let local = std::fs::read_to_string(git_dir.join("rebase-merge/head-name"))
        .ok()
        .and_then(|s| s.trim().strip_prefix("refs/heads/").map(str::to_string))
        .unwrap_or_else(|| "local".to_string());
    let incoming = std::fs::read_to_string(git_dir.join("rebase-merge/onto"))
        .ok()
        .and_then(|sha| resolve_sha_to_local_branch(repo_path, sha.trim()))
        .unwrap_or_else(|| "incoming".to_string());
    (local, incoming)
}

#[tauri::command]
pub async fn get_conflict_branch_info(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<ConflictBranchInfo, String> {
    let path = get_repo_path(&tab_id, &state)?;
    let git_dir = path.join(".git");

    let (local, incoming) = if git_dir.join("rebase-merge").exists() {
        read_rebase_branches(&path, &git_dir)
    } else {
        (read_head_branch(&git_dir), read_merge_incoming(&git_dir))
    };

    Ok(ConflictBranchInfo { local, incoming })
}

/// Run `git checkout <flag> -- <file>` then `git add -- <file>` (mark resolved).
fn checkout_and_add(path: &Path, flag: &str, file_path: &str) -> Result<(), String> {
    let p = path.to_string_lossy();
    let ok = crate::git_sync()
        .args(["-C", &p, "checkout", flag, "--", file_path])
        .status()
        .map_err(|e| e.to_string())?
        .success();
    if !ok { return Err(format!("git checkout {flag} -- {file_path} failed")); }
    let ok = crate::git_sync()
        .args(["-C", &p, "add", "--", file_path])
        .status()
        .map_err(|e| e.to_string())?
        .success();
    if !ok { return Err(format!("git add -- {file_path} failed")); }
    Ok(())
}

/// Resolve a conflict by keeping the local branch's version.
/// A rebase inverts --ours/--theirs relative to every other conflict source,
/// so we detect an in-progress rebase and pick the correct flag automatically.
#[tauri::command]
pub async fn resolve_conflict_local(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let git_dir = path.join(".git");
    // In-progress rebase: our commits are being replayed, so the local branch
    // is --theirs. Any other conflict in the working tree — a merge, cherry-pick
    // or revert started outside least-git (terminal / AI agent) — is a normal
    // merge, where the local branch is --ours (HEAD).
    let flag = if git_dir.join("rebase-merge").exists() { "--theirs" } else { "--ours" };
    info!("resolve_conflict_local tab={tab_id} file={file_path} flag={flag}");
    checkout_and_add(&path, flag, &file_path)
}

/// Resolve a conflict by keeping the incoming branch's version.
#[tauri::command]
pub async fn resolve_conflict_incoming(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = get_repo_path(&tab_id, &state)?;
    let git_dir = path.join(".git");
    // In-progress rebase: --ours is the rebase target, i.e. the incoming side.
    // Any other conflict left in the working tree — a merge, cherry-pick or
    // revert started outside least-git (terminal / AI agent) — is a normal
    // merge, where the incoming branch is --theirs (MERGE_HEAD).
    let flag = if git_dir.join("rebase-merge").exists() { "--ours" } else { "--theirs" };
    info!("resolve_conflict_incoming tab={tab_id} file={file_path} flag={flag}");
    checkout_and_add(&path, flag, &file_path)
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
            "--untracked-files=no", // untracked scanning is the bottleneck on large monorepos
                                    // (~2.9 s on a 300k-file repo); fetched separately via
                                    // get_untracked_files so tracked changes appear in ~400 ms
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

    let total_ms = t.elapsed().as_millis();
    let msg = format!(
        "get_working_tree_status staged={} modified={} total_ms={}",
        staged.len(),
        unstaged.len(),
        total_ms,
    );
    if total_ms > 1000 {
        warn!("[SLOW] {msg}");
    } else {
        info!("{msg}");
    }

    let head_branch = read_head_branch(&path.join(".git"));
    Ok(WorkingTreeStatus { staged, unstaged, head_branch })
}

/// Return paths of untracked (new) files — the slow part of `git status`.
///
/// Uses `git ls-files --others` instead of embedding untracked scanning in
/// `get_working_tree_status`. The caller fires both commands in parallel so
/// tracked changes (staged/modified) appear in ~400 ms while the untracked
/// walk (~2–3 s on large monorepos) finishes in the background.
#[tauri::command]
pub async fn get_untracked_files(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let t = std::time::Instant::now();
    let path = get_repo_path(&tab_id, &state)?;
    let path_str = path.to_string_lossy().to_string();

    let output = git_async()
        .args([
            "--no-optional-locks",
            "-C", &path_str,
            "ls-files",
            "--others",
            "--exclude-standard",
            "--no-empty-directory",
            "-z",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        warn!("get_untracked_files failed: {stderr}");
        return Err(format!("git ls-files failed: {stderr}"));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let files: Vec<String> = raw.split('\0').filter(|s| !s.is_empty()).map(str::to_string).collect();
    info!("get_untracked_files count={} ms={}", files.len(), t.elapsed().as_millis());
    Ok(files)
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

/// Maximum bytes read for an untracked-file preview. New files in a large
/// monorepo can be arbitrarily big (build artefacts, vendored blobs); cap the
/// read so the UI never has to hold or highlight a huge buffer.
const PREVIEW_MAX_BYTES: u64 = 512 * 1024; // 512 KiB

/// Contents of an untracked file for a syntax-highlighted preview. New files
/// have no diff, so the frontend renders their contents directly.
#[derive(Serialize)]
pub struct FilePreview {
    /// UTF-8 (lossy) file contents; empty when `is_binary`.
    content: String,
    /// A NUL byte was found in the sample — git's own "this is binary" heuristic.
    is_binary: bool,
    /// The file exceeded `PREVIEW_MAX_BYTES` and the content was cut off.
    truncated: bool,
}

/// Read an untracked file's contents for preview. Reads at most
/// `PREVIEW_MAX_BYTES` and flags binary/truncated so the UI can fall back to a
/// message instead of dumping garbage or blocking on a giant file.
#[tauri::command]
pub async fn read_file_preview(
    tab_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<FilePreview, String> {
    use tokio::io::AsyncReadExt;

    let repo = get_repo_path(&tab_id, &state)?;
    let full = repo.join(&file_path);

    let file = tokio::fs::File::open(&full).await.map_err(|e| e.to_string())?;

    // Read one byte past the cap so we can tell whether the file was truncated.
    let mut buf = Vec::new();
    let read = file
        .take(PREVIEW_MAX_BYTES + 1)
        .read_to_end(&mut buf)
        .await
        .map_err(|e| e.to_string())?;

    let truncated = read as u64 > PREVIEW_MAX_BYTES;
    if truncated {
        buf.truncate(PREVIEW_MAX_BYTES as usize);
    }

    // Binary heuristic: a NUL byte in the sample. Matches what `git diff` uses
    // to decide a file is binary and refuse to show a textual diff.
    if buf.contains(&0) {
        return Ok(FilePreview { content: String::new(), is_binary: true, truncated });
    }

    Ok(FilePreview {
        content: String::from_utf8_lossy(&buf).into_owned(),
        is_binary: false,
        truncated,
    })
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

/// Commit the currently staged changes — `git commit -F -`.
///
/// Shells out to the git binary (like every other mutating command here) so the
/// user's identity, commit hooks, and signing config are all honoured rather
/// than reimplemented. Only the index is committed — no `-a` — since staging is
/// done separately via [`stage_file`]/[`apply_patch`]. The message is piped
/// through stdin (`-F -`) so multi-line messages and leading dashes are safe,
/// and the default `whitespace` cleanup means `#` lines are kept verbatim.
#[tauri::command]
pub async fn commit_staged(
    tab_id: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    if message.trim().is_empty() {
        return Err("Commit message is empty".to_string());
    }

    let path = get_repo_path(&tab_id, &state)?;

    let mut child = git_async()
        .args(["commit", "-F", "-"])
        .current_dir(&path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    child.stdin.take().unwrap().write_all(message.as_bytes()).await.map_err(|e| e.to_string())?;

    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        // git reports "nothing to commit" and hook rejections on stdout, real
        // errors on stderr — surface whichever is populated.
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let msg = if stderr.is_empty() { stdout } else { stderr };
        warn!("commit_staged failed: {msg}");
        return Err(if msg.is_empty() { "git commit failed".to_string() } else { msg });
    }

    info!("commit_staged: committed staged changes");
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
    fn porcelain_conflict_uu() {
        // "UU path\0" — both sides modified, active conflict
        let raw = "UU src/conflict.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty(), "conflict must not appear in staged");
        assert_eq!(unstaged.len(), 1);
        assert_eq!(unstaged[0].status, "U");
        assert!(unstaged[0].is_conflict);
    }

    #[test]
    fn porcelain_conflict_aa() {
        // "AA path\0" — both sides added different content
        let raw = "AA src/new.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty(), "conflict must not appear in staged");
        assert_eq!(unstaged.len(), 1);
        assert!(unstaged[0].is_conflict);
    }

    #[test]
    fn porcelain_conflict_du() {
        // "DU path\0" — deleted by us, modified by them
        let raw = "DU src/lib.rs\0";
        let (staged, unstaged) = parse_porcelain_status(raw);
        assert!(staged.is_empty());
        assert_eq!(unstaged.len(), 1);
        assert!(unstaged[0].is_conflict);
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
