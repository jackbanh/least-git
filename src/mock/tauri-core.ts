// Mock for @tauri-apps/api/core — used when running in plain browser (npm run dev).
// Returns fixture data for every command the app invokes.

import {
  MOCK_TAB_ID,
  MOCK_TAB_PATH,
  MOCK_TAB_NAME,
  MOCK_COMMITS,
  MOCK_BRANCHES,
  MOCK_COMMIT_DETAIL,
  MOCK_DIFF,
  MOCK_WORKING_TREE,
} from "./fixtures";

const MOCK_TAB = {
  id:   MOCK_TAB_ID,
  path: MOCK_TAB_PATH,
  name: MOCK_TAB_NAME,
};

const PAGE_SIZE = 25;

// Latencies averaged from real app logs on a large monorepo (Windows, Q: drive, ~31 branches).
// Last updated from least-git9.log (2026-04-28).
const LATENCY: Record<string, number> = {
  open_repo:                100,
  list_branches:            300,  // avg 292ms (n=7)
  load_commits_head:        900,  // avg 892ms (n=7) — first page from HEAD
  load_commits_cursor:     1000,  // avg 1016ms (n=8) — subsequent pages
  get_commit_detail:        950,  // avg 949ms (n=2)
  get_file_diff:            120,
  get_staged_diff:          120,
  get_unstaged_diff:        120,
  get_working_tree_status: 8500,  // avg 8540ms (n=5) — large untracked tree
  default:                   60,
};

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invoke<T = unknown>(cmd: string, _args?: Record<string, unknown>): Promise<T> {

  switch (cmd) {
    case "open_repo":
      await delay(LATENCY.open_repo);
      return MOCK_TAB as T;

    case "close_tab":
    case "clear_detail_cache":
    case "create_branch":
    case "stage_file":
    case "unstage_file":
    case "discard_changes":
    case "apply_patch":
      return undefined as T;

    case "list_branches":
      await delay(LATENCY.list_branches);
      return MOCK_BRANCHES as T;

    case "load_commits": {
      const args = _args as { afterOid: string | null; limit?: number };
      const limit = args?.limit ?? PAGE_SIZE;
      if (!args?.afterOid) {
        await delay(LATENCY.load_commits_head);
        return MOCK_COMMITS.slice(0, limit) as T;
      }
      await delay(LATENCY.load_commits_cursor);
      const idx = MOCK_COMMITS.findIndex((c) => c.oid === args.afterOid);
      const start = idx === -1 ? 0 : idx + 1;
      return MOCK_COMMITS.slice(start, start + limit) as T;
    }

    case "get_commit_detail":
      await delay(LATENCY.get_commit_detail);
      return MOCK_COMMIT_DETAIL as T;

    case "get_file_diff":
    case "get_staged_diff":
    case "get_unstaged_diff":
      await delay(LATENCY.get_file_diff);
      return MOCK_DIFF as T;

    case "get_working_tree_status":
      await delay(LATENCY.get_working_tree_status);
      return MOCK_WORKING_TREE as T;

    case "git_pull":
    case "git_push":
      await delay(2000);
      return "" as T;

    default:
      console.warn(`[mock] unhandled invoke: ${cmd}`, _args);
      return undefined as T;
  }
}
