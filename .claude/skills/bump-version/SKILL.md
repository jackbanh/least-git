---
name: bump-version
description: Release-version bump for least-git — propagates the version across package.json, Cargo.toml, tauri.conf.json, the README badge, and both lockfiles, then verifies with a real build. Use this whenever the version is being changed or a release is being cut, including phrasings like "bump to 0.7.0", "cut a release", "ship v1.0", "prep the release", "update the version", or when a dependency upgrade also bumps the app version. Also use it to diagnose a version that looks wrong or out of sync anywhere.
---

# Bumping least-git's version

The version lives in six places that can silently disagree. `npm ci` (what
`.github/workflows/ci.yml` runs) neither updates nor complains about a stale root
version in `package-lock.json` — verified — so a lockfile left behind stays wrong
indefinitely. This has already happened here: commit `09336a5` bumped the app to
0.6.0 but left `package-lock.json` at 0.5.0, and it only self-corrected three
commits later when an unrelated dependency update happened to run `npm install`.
Cargo is stricter in the other direction: `cargo build --locked` *hard-fails* on a
stale `Cargo.lock` rather than fixing it.

So the point of this skill is: edit one file, let tooling propagate, verify all six.

`src/__tests__/version.test.ts` is the backstop — it asserts all six locations
agree and rides on `npm test`, so CI now fails on drift. It tells you *that* a
bump is incomplete; this skill is how you do one correctly.

## The six locations

| Location | How it gets updated |
| --- | --- |
| `package.json` → `version` | source of truth — edit this one |
| `src-tauri/Cargo.toml` → `[package] version` | hand edit |
| `src-tauri/tauri.conf.json` → `version` | hand edit (this is what `getVersion()` returns in the real app) |
| `README.md` shields.io badge | hand edit |
| `package-lock.json` (two spots) | `npm install` — **only** a plain install; `npm ci` won't do it |
| `src-tauri/Cargo.lock` (`least-git` entry) | any cargo command that touches the lockfile |

`package.json` is the source of truth because `src/mock/tauri-app.ts` imports it
directly for the browser mock's About pane, so keeping it authoritative means the
mock and the real app can't disagree.

## Workflow

1. **Propagate.** From the repo root:

   ```bash
   .claude/skills/bump-version/scripts/sync-version.sh 0.7.0
   ```

   It writes `package.json`, propagates to the other three files, runs
   `npm install --package-lock-only` and `cargo metadata` to sync both lockfiles,
   then prints every location with `ok` / `DRIFT` and exits non-zero on drift.
   Run it with `--check` (no arguments beyond that) to audit without changing
   anything — useful when someone reports a version looking wrong.

2. **Review the diff.** A correct bump is roughly seven changed lines across six
   files. Anything larger means a lockfile picked up unrelated dependency churn —
   that belongs in its own commit, not the version bump.

3. **Verify with a real build.**

   ```bash
   npm run tauri build
   ```

   This is the step that actually proves the bump is coherent: Tauri reads
   `tauri.conf.json`, cargo reads `Cargo.toml` against `Cargo.lock`, and the
   bundle gets named from the version. A `--check` pass alone can't catch a
   malformed version string or a conf the bundler rejects. Don't skip it and
   don't substitute `cargo check` — the bundling stage is the part under test.

   **The DMG step fails on this machine, and that's expected.** The run ends with:

   ```
   Bundling least-git_0.7.0_aarch64.dmg
   failed to bundle project: error running bundle_dmg.sh
   ```

   The maintainer's read is that local signing credentials aren't set up — the
   Apple secrets in `release.yml` are optional and only CI has them, and the same
   failure has been leaving stale `rw.*.dmg` temp files in
   `src-tauri/target/release/bundle/macos/` since at least 0.4.0. It is not
   caused by the version bump and does not invalidate it. (The exact cause has
   never been confirmed, so don't state it as fact — if a bump ever needs a truly
   clean build, that's worth diagnosing first.)

   So judge the build on what comes *before* the DMG stage:

   - `Compiling least-git v<X.Y.Z>` — Cargo.toml and Cargo.lock agree
   - `Built application at: .../target/release/least-git`
   - the DMG filename carries the new version — tauri.conf.json flowed through
   - `plutil -extract CFBundleShortVersionString raw src-tauri/target/release/bundle/macos/least-git.app/Contents/Info.plist`
     returns the new version

   Read the log rather than trusting an exit code here — a `npm run tauri build`
   piped through `tail` has reported success while actually failing on `tsc`.

4. **Commit** all six files together. Splitting them is what produced the 0.6.0
   lockfile drift in the first place.

5. **Tag, if this is a release.** `.github/workflows/release.yml` triggers on
   tags matching `v[0-9]+.[0-9]+.[0-9]+` — so the tag must be `v0.7.0`, exactly
   matching the version in the files. A mismatch produces a release whose
   artifacts are named differently from its tag. Pushing the tag is the user's
   call; ask before doing it.

## If something looks off

- **You reverted a file with `git checkout` mid-bump and the version went
  backwards** — until the bump is committed, HEAD still holds the *old* version,
  so `git checkout -- <file>` un-bumps it. Re-run the script with no argument to
  re-propagate from `package.json`.

- **`cargo build --locked` fails with "cannot update the lock file"** — `Cargo.toml`
  was bumped without `Cargo.lock`. Run the script; it fixes both.
- **About pane shows the old version in the packaged app** — that reads
  `tauri.conf.json`, not `package.json`. In the browser mock it reads
  `package.json` instead, so the two can look different if only one was bumped.
- **The version regressed after a `git merge`** — lockfiles conflict on the
  version line constantly. Resolve to the higher version, then re-run `--check`.
