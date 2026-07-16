use crate::{git_async, get_repo_path, AppState, ChangedFile, CommitDetail, CommitInfo};
use gix::bstr::ByteSlice;
use log::{info, warn};
use tauri::State;

/// Splits a raw git commit message into (summary, body).
/// Summary is the first line (trimmed). Body is everything after, also trimmed.
pub(crate) fn split_message(msg: &[u8]) -> (String, String) {
    let end = msg.iter().position(|&b| b == b'\n').unwrap_or(msg.len());
    let summary = String::from_utf8_lossy(&msg[..end]).trim().to_string();
    let body = if end < msg.len() {
        String::from_utf8_lossy(&msg[end..]).trim().to_string()
    } else {
        String::new()
    };
    (summary, body)
}

/// Parse `git diff-tree --name-status` output into a list of changed files.
///
/// Each line is `"STATUS\tpath"` or `"STATUS\told\tnew"` for renames/copies.
/// The status field may include a similarity score (e.g. `R100`, `C75`); only
/// the first byte is used.  Blank lines and lines without a tab are skipped.
pub(crate) fn parse_diff_tree_output(output: &str) -> Vec<ChangedFile> {
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
            Some(ChangedFile { path, old_path, status })
        })
        .collect()
}

#[tauri::command]
pub fn load_commits(
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
        let parent_oid = decoded.parents.first().map(ToString::to_string);

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
pub async fn get_commit_detail(
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
    let files = parse_diff_tree_output(&String::from_utf8_lossy(&files_out.stdout));

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
pub async fn get_file_diff(
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

/// Maps a reset mode from the frontend onto a git flag.
///
/// Only `soft` and `hard` are accepted. The mode is matched against a fixed set
/// rather than forwarded, so an unexpected value can never reach git's argument
/// list as an arbitrary flag.
pub(crate) fn reset_mode_flag(mode: &str) -> Result<&'static str, String> {
    match mode {
        "soft" => Ok("--soft"),
        "hard" => Ok("--hard"),
        other => Err(format!("invalid reset mode: {other}")),
    }
}

/// Rejects anything that is not a plain hex object id.
///
/// Beyond catching typos, this stops a value starting with `-` from being
/// parsed by git as an option instead of a commit.
pub(crate) fn validate_oid(oid: &str) -> Result<(), String> {
    let ok = (4..=64).contains(&oid.len()) && oid.bytes().all(|b| b.is_ascii_hexdigit());
    if ok { Ok(()) } else { Err(format!("invalid commit id: {oid}")) }
}

/// Move the current branch to `oid`.
///
/// `soft` keeps the index and working tree, so the reset commits' changes are
/// left staged. `hard` discards them — it is destructive and unrecoverable for
/// uncommitted work, so the confirmation lives in the UI.
#[tauri::command]
pub async fn reset_to_commit(
    tab_id: String,
    oid: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let flag = reset_mode_flag(&mode)?;
    validate_oid(&oid)?;
    let path = get_repo_path(&tab_id, &state)?;

    let out = git_async()
        .args(["reset", flag, &oid])
        .current_dir(&path)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        warn!("reset_to_commit failed: {msg}");
        return Err(if msg.is_empty() { "git reset failed".to_string() } else { msg });
    }

    info!("reset_to_commit: {flag} {oid}");
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── reset validation ─────────────────────────────────────────────────────

    #[test]
    fn reset_mode_maps_known_modes() {
        assert_eq!(reset_mode_flag("soft").unwrap(), "--soft");
        assert_eq!(reset_mode_flag("hard").unwrap(), "--hard");
    }

    #[test]
    fn reset_mode_rejects_unknown_modes() {
        // --mixed is deliberately not offered by the UI.
        assert!(reset_mode_flag("mixed").is_err());
        assert!(reset_mode_flag("").is_err());
        assert!(reset_mode_flag("HARD").is_err());
    }

    #[test]
    fn reset_mode_rejects_flag_injection() {
        assert!(reset_mode_flag("--hard").is_err());
        assert!(reset_mode_flag("hard --force").is_err());
    }

    #[test]
    fn validate_oid_accepts_hex_ids() {
        assert!(validate_oid("a059057751409dc2b48a62445879e1fa26b60682").is_ok());
        assert!(validate_oid("706a68e").is_ok());
    }

    #[test]
    fn validate_oid_rejects_non_hex_and_options() {
        assert!(validate_oid("--hard").is_err());
        assert!(validate_oid("-HEAD").is_err());
        assert!(validate_oid("HEAD~1").is_err());
        assert!(validate_oid("main").is_err());
        assert!(validate_oid("").is_err());
    }

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

    #[test]
    fn split_message_crlf_line_ending() {
        // Windows git can produce CRLF-terminated summary lines.
        // The \r should be trimmed so callers never see it.
        let (summary, body) = split_message(b"Fix the bug\r\n\r\nBody text.");
        assert_eq!(summary, "Fix the bug");
        assert_eq!(body, "Body text.");
    }

    // ── parse_diff_tree_output ───────────────────────────────────────────────
    // These test the real production function used inside get_commit_detail.

    #[test]
    fn diff_tree_modified() {
        let out = "M\tsrc/main.rs\n";
        let files = parse_diff_tree_output(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].path, "src/main.rs");
        assert!(files[0].old_path.is_none());
    }

    #[test]
    fn diff_tree_added_and_deleted() {
        let out = "A\tnew_file.rs\nD\told_file.rs\n";
        let files = parse_diff_tree_output(out);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].status, "A");
        assert_eq!(files[1].status, "D");
    }

    #[test]
    fn diff_tree_rename_with_score() {
        // diff-tree emits "R<score>\told\tnew"; only the first byte ("R") is the status.
        let out = "R100\told/path.rs\tnew/path.rs\n";
        let files = parse_diff_tree_output(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "R");
        assert_eq!(files[0].path, "new/path.rs");
        assert_eq!(files[0].old_path.as_deref(), Some("old/path.rs"));
    }

    #[test]
    fn diff_tree_copy_with_score() {
        let out = "C75\tsrc/original.rs\tsrc/copy.rs\n";
        let files = parse_diff_tree_output(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "C");
        assert_eq!(files[0].path, "src/copy.rs");
        assert_eq!(files[0].old_path.as_deref(), Some("src/original.rs"));
    }

    #[test]
    fn diff_tree_spaces_in_path() {
        // Paths containing spaces must be preserved verbatim.
        let out = "M\tsrc/my file with spaces.rs\n";
        let files = parse_diff_tree_output(out);
        assert_eq!(files[0].path, "src/my file with spaces.rs");
    }

    #[test]
    fn diff_tree_empty_output() {
        assert!(parse_diff_tree_output("").is_empty());
    }

    #[test]
    fn diff_tree_skips_malformed_lines() {
        // Lines without a tab (e.g. blank separator lines) must be silently skipped.
        let out = "not-a-valid-line\nM\tvalid.rs\n";
        let files = parse_diff_tree_output(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "valid.rs");
    }

    #[test]
    fn diff_tree_multiple_statuses() {
        let out = "M\tsrc/a.rs\nA\tsrc/b.rs\nD\tsrc/c.rs\nR90\told.rs\tnew.rs\n";
        let files = parse_diff_tree_output(out);
        assert_eq!(files.len(), 4);
        assert_eq!(files[3].old_path.as_deref(), Some("old.rs"));
    }

    #[test]
    fn diff_tree_rename_old_path_not_leaked_as_new() {
        // When a rename is detected, `path` must be the NEW path, not the old one.
        let out = "R100\tsrc/old_name.rs\tsrc/new_name.rs\n";
        let files = parse_diff_tree_output(out);
        assert_eq!(files[0].path, "src/new_name.rs");
        assert_ne!(files[0].path, "src/old_name.rs");
    }
}
