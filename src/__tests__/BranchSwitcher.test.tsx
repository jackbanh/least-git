import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BranchSwitcher from "../components/BranchSwitcher";

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

function Wrapper({ client, listKey }: { client: QueryClient; listKey: number }) {
  return (
    <QueryClientProvider client={client}>
      <MantineProvider>
        <BranchSwitcher tabId="test-tab" listKey={listKey} />
      </MantineProvider>
    </QueryClientProvider>
  );
}

function renderBranchSwitcher(listKey = 0) {
  const client = makeQueryClient();
  const { rerender, ...rest } = render(<Wrapper client={client} listKey={listKey} />);
  return {
    client,
    rerender: (newListKey: number) => rerender(<Wrapper client={client} listKey={newListKey} />),
    ...rest,
  };
}

describe("BranchSwitcher", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("loads and displays branches on mount", async () => {
    mockInvoke.mockResolvedValue([BRANCH_A, BRANCH_B]);

    renderBranchSwitcher();

    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();
  });

  it("keeps previous branches visible while a listKey-triggered refresh is in flight", async () => {
    // Regression: branch list must not go blank between a listKey bump and the
    // new list arriving. TanStack Query shows cached data (placeholderData) while
    // the background refetch runs.
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);
    const { rerender } = renderBranchSwitcher(0);

    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    // Trigger refresh — fetch is pending, never resolves in this test
    mockInvoke.mockReturnValueOnce(new Promise(() => {}));
    rerender(1);

    // Both branches must still be visible while the refresh is in flight
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();
  });

  it("updates the branch list when a refresh resolves with new data", async () => {
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);
    const { rerender } = renderBranchSwitcher(0);
    await waitFor(() => expect(screen.getByText("feature/new-ui")).toBeInTheDocument());

    const updatedB = { name: "feature/redesign", is_head: false };
    mockInvoke.mockResolvedValueOnce([BRANCH_A, updatedB]);
    rerender(1);

    await waitFor(() => expect(screen.getByText("feature/redesign")).toBeInTheDocument());
    expect(screen.queryByText("feature/new-ui")).not.toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows cached branches immediately on remount (simulates tab switch)", async () => {
    // Regression: before TanStack Query, lastKnownBranchesRef was component-local
    // and reset to [] on every remount. Tab switches caused a ~700ms blank.
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

    // Resolve with a slimmed-down list
    resolveRemount([BRANCH_A]);
    await waitFor(() => expect(screen.queryByText("feature/new-ui")).not.toBeInTheDocument());
    expect(screen.getByText("main")).toBeInTheDocument();
  });
});
