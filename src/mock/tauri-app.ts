// Mock for @tauri-apps/api/app — used when running in a plain browser (npm run dev).
// The real getVersion() returns the version from tauri.conf.json; here we read
// package.json (kept in sync) so the About pane shows a realistic value.
import pkg from "../../package.json";

export async function getVersion(): Promise<string> {
  return pkg.version;
}
