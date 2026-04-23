import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BranchSwitcher, { __resetBranchCache } from "../components/BranchSwitcher";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock("../store", () => ({
  useTabStore: vi.fn((selector: (s: object) => unknown) =>
    selector({
      bumpListKey: vi.fn(),
      selectCommit: vi.fn(),
    })
  ),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const BRANCH_A = { name: "main", is_head: true };
const BRANCH_B = { name: "feature/new-ui", is_head: false };

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
  });
}

function Wrapper({
  client,
  tabId = "test-tab",
  listKey,
}: {
  client: QueryClient;
  tabId?: string;
  listKey: number;
}) {
  return (
    <QueryClientProvider client={client}>
      <MantineProvider>
        <BranchSwitcher tabId={tabId} listKey={listKey} />
      </MantineProvider>
    </QueryClientProvider>
  );
}

describe("BranchSwitcher", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    __resetBranchCache();
  });

  it("loads and displays branches on mount", async () => {
    mockInvoke.mockResolvedValue([BRANCH_A, BRANCH_B]);
    const client = makeQueryClient();

    render(<Wrapper client={client} listKey={0} />);

    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();
  });

  it("keeps previous branches visible while a listKey-triggered refresh is in flight", async () => {
    // Regression: branch list must not go blank between a listKey bump and the
    // new list arriving. TanStack Query shows cached data while the background
    // refetch runs, and branchCache provides initialData if the TQ cache is cold.
    const client = makeQueryClient();
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);

    const { rerender } = render(<Wrapper client={client} listKey={0} />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    // Trigger refresh — fetch is pending, never resolves in this test
    mockInvoke.mockReturnValueOnce(new Promise(() => {}));
    rerender(<Wrapper client={client} listKey={1} />);

    // Both branches must still be visible while the refresh is in flight
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();
  });

  it("updates the branch list when a refresh resolves with new data", async () => {
    const client = makeQueryClient();
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);

    const { rerender } = render(<Wrapper client={client} listKey={0} />);
    await waitFor(() => expect(screen.getByText("feature/new-ui")).toBeInTheDocument());

    const updatedB = { name: "feature/redesign", is_head: false };
    mockInvoke.mockResolvedValueOnce([BRANCH_A, updatedB]);
    rerender(<Wrapper client={client} listKey={1} />);

    await waitFor(() => expect(screen.getByText("feature/redesign")).toBeInTheDocument());
    expect(screen.queryByText("feature/new-ui")).not.toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows cached branches immediately on remount (simulates tab switch)", async () => {
    // Regression: before TanStack Query, lastKnownBranchesRef was component-local
    // and reset to [] on every remount. Tab switches caused a blank flash.
    // Now the QueryClient cache (gcTime: Infinity) persists outside the component
    // tree, so cached data is available the instant the component remounts.
    const client = makeQueryClient();
    mockInvoke.mockResolvedValue([BRANCH_A, BRANCH_B]);

    // First mount — loads branches into QueryClient cache
    const { unmount } = render(<Wrapper client={client} listKey={0} />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    unmount();

    // Simulate next fetch being slow (e.g. slow disk on tab switch)
    let resolveRemount!: (v: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((res) => { resolveRemount = res; }));

    // Remount with the same client — simulates switching back to this tab
    render(<Wrapper client={client} listKey={1} />);

    // Stale cache data must be visible immediately — no blank flash
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();

    // Resolve with a slimmed-down list to confirm the live update lands
    resolveRemount([BRANCH_A]);
    await waitFor(() => expect(screen.queryByText("feature/new-ui")).not.toBeInTheDocument());
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows stale branches via branchCache when the TanStack Query cache is cold", async () => {
    // This covers the specific fix: initialData seeded from the module-level
    // branchCache. When the TQ cache is evicted (e.g. after a tab switch that
    // caused the observer to watch a different queryKey), branchCache ensures the
    // branch list never flashes blank on return.
    const client = makeQueryClient();
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);

    // First visit — populates both TQ cache and branchCache
    const { rerender } = render(<Wrapper client={client} tabId="tab-a" listKey={0} />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    // Evict the TQ cache entry to simulate a cold cache on return
    client.removeQueries({ queryKey: ["branches", "tab-a"] });

    // Return to tab-a with a slow fetch — only branchCache can fill the gap
    let resolveFetch!: (v: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((res) => { resolveFetch = res; }));
    rerender(<Wrapper client={client} tabId="tab-a" listKey={1} />);

    // branchCache provides initialData — no blank flash despite cold TQ cache
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();

    resolveFetch([BRANCH_A, BRANCH_B]);
  });
});
