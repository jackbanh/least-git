import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

// Branches live in a Menu dropdown — open it to make them visible.
function openDropdown() {
  fireEvent.click(document.querySelector(".branch-dropdown-btn")!);
}

// Query the branch list items directly to avoid ambiguity: when the dropdown is
// open "main" appears in both the button label and the list row.
function branchListNames(): string[] {
  return Array.from(document.querySelectorAll(".branch-row-name")).map(
    (el) => el.textContent ?? ""
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

    // Head branch appears in the button label before the dropdown is opened
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    // Non-head branches are inside the Menu dropdown — open it first
    openDropdown();
    await waitFor(() => expect(branchListNames()).toContain("feature/new-ui"));
    expect(branchListNames()).toContain("main");
  });

  it("keeps previous branches visible while a listKey-triggered refresh is in flight", async () => {
    // Regression: branch list must not go blank between a listKey bump and the
    // new list arriving. TanStack Query shows cached data while the background
    // refetch runs, and branchCache provides initialData if the TQ cache is cold.
    const client = makeQueryClient();
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);

    const { rerender } = render(<Wrapper client={client} listKey={0} />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    openDropdown();
    await waitFor(() => expect(branchListNames()).toContain("feature/new-ui"));

    // Trigger refresh — fetch is pending, never resolves in this test
    mockInvoke.mockReturnValueOnce(new Promise(() => {}));
    rerender(<Wrapper client={client} listKey={1} />);

    // Both branches must still be visible in the open dropdown while refresh is in flight
    expect(branchListNames()).toContain("main");
    expect(branchListNames()).toContain("feature/new-ui");
  });

  it("updates the branch list when a refresh resolves with new data", async () => {
    const client = makeQueryClient();
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);

    const { rerender } = render(<Wrapper client={client} listKey={0} />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    openDropdown();
    await waitFor(() => expect(branchListNames()).toContain("feature/new-ui"));

    const updatedB = { name: "feature/redesign", is_head: false };
    mockInvoke.mockResolvedValueOnce([BRANCH_A, updatedB]);
    rerender(<Wrapper client={client} listKey={1} />);

    await waitFor(() => expect(branchListNames()).toContain("feature/redesign"));
    expect(branchListNames()).not.toContain("feature/new-ui");
    expect(branchListNames()).toContain("main");
  });

  it("closes the dropdown when HEAD changes externally (another process switches branch)", async () => {
    // Bug fix: if a terminal or other process checks out a different branch, the
    // FSMonitor-driven refetch updates which branch is_head. The open dropdown
    // must close so it doesn't show a stale "current" marker.
    const client = makeQueryClient();
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);

    const { rerender } = render(<Wrapper client={client} listKey={0} />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    openDropdown();
    await waitFor(() => expect(branchListNames()).toContain("feature/new-ui"));
    expect(document.querySelector(".branch-popover-dropdown")).not.toBeNull();

    // External switch: feature/new-ui becomes HEAD
    mockInvoke.mockResolvedValueOnce([
      { name: "main", is_head: false },
      { name: "feature/new-ui", is_head: true },
    ]);
    rerender(<Wrapper client={client} listKey={1} />);

    await waitFor(() =>
      expect(document.querySelector(".branch-popover-dropdown")).toBeNull()
    );
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

    // Open dropdown; stale cache data must be visible immediately — no blank flash
    openDropdown();
    await waitFor(() => {
      expect(branchListNames()).toContain("main");
      expect(branchListNames()).toContain("feature/new-ui");
    });

    // Resolve with a slimmed-down list to confirm the live update lands
    resolveRemount([BRANCH_A]);
    await waitFor(() => expect(branchListNames()).not.toContain("feature/new-ui"));
    expect(branchListNames()).toContain("main");
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

    // Open dropdown; branchCache provides initialData — no blank flash despite cold TQ cache
    openDropdown();
    await waitFor(() => {
      expect(branchListNames()).toContain("main");
      expect(branchListNames()).toContain("feature/new-ui");
    });

    resolveFetch([BRANCH_A, BRANCH_B]);
  });
});
