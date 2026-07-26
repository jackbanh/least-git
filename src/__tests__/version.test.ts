import { describe, it, expect } from "vitest";
import pkg from "../../package.json";
import tauriConf from "../../src-tauri/tauri.conf.json";
import cargoToml from "../../src-tauri/Cargo.toml?raw";
import cargoLock from "../../src-tauri/Cargo.lock?raw";
import packageLock from "../../package-lock.json?raw";
import readme from "../../README.md?raw";

// The release version is duplicated across six files, and none of the other CI
// steps notice when they disagree — `npm ci` neither syncs nor complains about a
// stale root version in package-lock.json. That has already gone wrong once
// (09336a5 bumped the app to 0.6.0 and left package-lock.json at 0.5.0 for three
// commits), so this test is the thing that catches it.
//
// To fix a failure, don't hand-edit the odd file out — run
// `.claude/skills/bump-version/scripts/sync-version.sh` from the repo root so the
// lockfiles get regenerated properly too.
//
// These are `?raw` imports rather than fs reads because the frontend tsconfig is
// browser-only (no @types/node), and because pulling package-lock.json in as
// typed JSON would make tsc infer a type for the whole dependency tree.

const expected = pkg.version;

describe("release version", () => {
  it("is a plain X.Y.Z, as release.yml's tag pattern requires", () => {
    expect(expected).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("matches src-tauri/Cargo.toml", () => {
    // First `version = "x.y.z"` in the file is the [package] one.
    expect(cargoToml.match(/^version = "(.+)"/m)?.[1]).toBe(expected);
  });

  it("matches src-tauri/tauri.conf.json, which getVersion() reports at runtime", () => {
    expect(tauriConf.version).toBe(expected);
  });

  it("matches the README badge", () => {
    expect(readme.match(/badge\/version-(\d+\.\d+\.\d+)-blue/)?.[1]).toBe(
      expected,
    );
  });

  it("matches package-lock.json, which npm ci will not fix on its own", () => {
    const lock = JSON.parse(packageLock) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe(expected);
    expect(lock.packages[""].version).toBe(expected);
  });

  it("matches src-tauri/Cargo.lock, which cargo --locked builds enforce", () => {
    // The `least-git` entry among Cargo.lock's [[package]] blocks.
    expect(cargoLock.match(/^name = "least-git"\nversion = "(.+)"/m)?.[1]).toBe(
      expected,
    );
  });
});
