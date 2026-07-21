//! Shared test helpers that build throwaway git repositories on disk.
//!
//! These back the gix regression tests: they exercise the real gix code paths
//! (`list_branches_at`, `load_commits_at`, `commit_meta_at`,
//! `resolve_sha_to_local_branch`) against actual repositories so a gix upgrade
//! that changes behavior — walk order, HEAD detection, timestamp semantics —
//! is caught, not just API breakage the compiler already flags.

use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

/// Fixed author/committer date applied to every commit, as git's `@<unix> <tz>`
/// form so the decoded timestamp is exactly `EPOCH_SECONDS`.
const EPOCH: &str = "@1700000000 +0000";
pub(crate) const EPOCH_SECONDS: i64 = 1_700_000_000;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "Test Author")
        .env("GIT_AUTHOR_EMAIL", "author@example.com")
        .env("GIT_COMMITTER_NAME", "Test Author")
        .env("GIT_COMMITTER_EMAIL", "author@example.com")
        .env("GIT_AUTHOR_DATE", EPOCH)
        .env("GIT_COMMITTER_DATE", EPOCH)
        .output()
        .expect("failed to spawn git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn commit(dir: &Path, file: &str, contents: &str, message: &str) {
    std::fs::write(dir.join(file), contents).unwrap();
    git(dir, &["add", file]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// Linear `main` history (oldest→newest: "first commit", "second commit",
/// "third commit"), plus two extra local branches (`feature/x`, `zebra`) created
/// at the tip. HEAD is on `main`. The third commit carries a multi-line body.
pub(crate) fn linear_repo() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    git(p, &["init", "-q", "-b", "main"]);
    commit(p, "a.txt", "a", "first commit");
    commit(p, "b.txt", "b", "second commit");
    // Third commit: summary + body (two -m flags become summary and body).
    std::fs::write(p.join("c.txt"), "c").unwrap();
    git(p, &["add", "c.txt"]);
    git(p, &["commit", "-q", "-m", "third commit", "-m", "Body line one.\nBody line two."]);
    // Extra branches, created without switching off main.
    git(p, &["branch", "feature/x"]);
    git(p, &["branch", "zebra"]);
    dir
}

/// `main` whose tip is a merge commit bringing in "side commit" as the SECOND
/// parent. A first-parent walk from HEAD must yield
/// [merge side, base three, base two, base one] and never "side commit".
pub(crate) fn merge_repo() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    git(p, &["init", "-q", "-b", "main"]);
    commit(p, "base.txt", "1", "base one");
    commit(p, "base.txt", "2", "base two");
    git(p, &["switch", "-q", "-c", "side"]);
    commit(p, "side.txt", "s", "side commit");
    git(p, &["switch", "-q", "main"]);
    commit(p, "base.txt", "3", "base three");
    git(p, &["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    dir
}
