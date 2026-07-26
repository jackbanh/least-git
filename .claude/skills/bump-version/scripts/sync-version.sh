#!/usr/bin/env bash
# Propagate the version in package.json to every other place that carries it,
# then report any location still out of sync.
#
#   ./sync-version.sh            # propagate package.json's current version
#   ./sync-version.sh 0.7.0      # set package.json to 0.7.0 first, then propagate
#   ./sync-version.sh --check    # report only, change nothing (exit 1 on drift)
#
# package.json is the source of truth because the browser mock imports it
# directly (src/mock/tauri-app.ts) and npm owns it anyway.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

CHECK_ONLY=0
NEW_VERSION=""
case "${1:-}" in
  --check) CHECK_ONLY=1 ;;
  "") ;;
  -*) echo "unknown flag: $1" >&2; exit 2 ;;
  *) NEW_VERSION="$1" ;;
esac

if [[ -n "$NEW_VERSION" ]]; then
  [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "version must be X.Y.Z (the release tag regex expects it): $NEW_VERSION" >&2
    exit 2
  }
  node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync("package.json", "utf8"));
    j.version = process.argv[1];
    fs.writeFileSync("package.json", JSON.stringify(j, null, 2) + "\n");
  ' "$NEW_VERSION"
fi

V="$(node -p 'require("./package.json").version')"
echo "target version: $V"

# Replace only the first match — Cargo.toml has [package] version first, and
# tauri.conf.json's top-level "version" precedes any nested one.
replace_first() {
  local file="$1" pattern="$2" replacement="$3"
  perl -0777 -i -pe "s/$pattern/$replacement/" "$file"
}

if [[ $CHECK_ONLY -eq 0 ]]; then
  replace_first src-tauri/Cargo.toml     'version = "\d+\.\d+\.\d+"'   "version = \"$V\""
  replace_first src-tauri/tauri.conf.json '"version": "\d+\.\d+\.\d+"' "\"version\": \"$V\""
  replace_first README.md 'badge\/version-\d+\.\d+\.\d+-blue'          "badge\/version-$V-blue"

  # Lockfiles carry the version too, and nothing in CI fixes them:
  # `npm ci` neither updates nor complains about a stale root version, so
  # package-lock.json stays wrong until someone runs a plain `npm install`.
  # `cargo build --locked` (used by some release setups) hard-fails instead.
  npm install --package-lock-only --silent
  cargo metadata -q --manifest-path src-tauri/Cargo.toml --format-version 1 >/dev/null
fi

fail=0
report() {
  local label="$1" found="$2"
  if [[ "$found" == "$V" ]]; then
    printf '  ok    %-24s %s\n' "$label" "$found"
  else
    printf '  DRIFT %-24s %s (expected %s)\n' "$label" "${found:-<not found>}" "$V"
    fail=1
  fi
}

echo "locations:"
report package.json       "$(node -p 'require("./package.json").version')"
report src-tauri/Cargo.toml "$(perl -ne 'if (/^version = "(.+)"/) { print $1; exit }' src-tauri/Cargo.toml)"
report tauri.conf.json    "$(node -p 'require("./src-tauri/tauri.conf.json").version')"
report "README.md badge"  "$(perl -ne 'if (/badge\/version-(\d+\.\d+\.\d+)-blue/) { print $1; exit }' README.md)"
report package-lock.json  "$(node -p 'require("./package-lock.json").version')"
report Cargo.lock         "$(perl -ne 'if ($p) { if (/^version = "(.+)"/) { print $1; exit } } $p = 1 if /^name = "least-git"$/' src-tauri/Cargo.lock)"

exit $fail
