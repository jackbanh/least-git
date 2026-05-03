use crate::{git_async, get_repo_path, AppState, BranchInfo, PullDone, PullLine};
use gix::bstr::ByteSlice;
use log::{info, warn};
use tauri::{Emitter, State};

/// Parse `git branch` text output into a sorted BranchInfo list.
/// Used only in unit tests; production uses the gix API directly.
#[cfg(test)]
pub(crate) fn parse_branches(raw: &str) -> Vec<BranchInfo> {
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

#[tauri::command]
pub async fn list_branches(tab_id: String, state: State<'_, AppState>) -> Result<Vec<BranchInfo>, String> {
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
            .filter_map(Result::ok)
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
pub async fn create_branch(
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
pub async fn checkout_branch(
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
            for part in line.split('\r').filter(|s| !s.trim().is_empty()) {
                emit_line(part.to_string());
            }
        }
    });
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            for part in line.split('\r').filter(|s| !s.trim().is_empty()) {
                emit_line2(part.to_string());
            }
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = tokio::join!(out_task, err_task);

    let _ = app.emit("checkout:done", PullDone { tab_id, success: status.success() });

    let elapsed = checkout_start.elapsed().as_millis();
    if !status.success() {
        warn!("checkout_branch failed: {branch} ({elapsed}ms)");
        return Err(format!("git checkout {branch} failed"));
    }

    info!("checkout_branch done: {branch} ({elapsed}ms)");
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
}
