import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
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

function renderBranchSwitcher(listKey = 0) {
  return render(
    <MantineProvider>
      <BranchSwitcher tabId="test-tab" listKey={listKey} />
    </MantineProvider>
  );
}

function rerenderBranchSwitcher(
  rerender: (ui: React.ReactElement) => void,
  listKey: number
) {
  rerender(
    <MantineProvider>
      <BranchSwitcher tabId="test-tab" listKey={listKey} />
    </MantineProvider>
  );
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

  it("skips a watcher-triggered refresh when the initial fetch is still in flight", async () => {
    // Regression: if a repo:changed watcher event fires while the very first
    // list_branches fetch is still pending (no data yet, no stale to show),
    // starting a duplicate fetch only extends the blank-list window. The guard
    // should skip the second fetch and let the original complete instead.
    let resolveInitial!: (v: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((res) => { resolveInitial = res; }));

    const { rerender } = renderBranchSwitcher(0);

    // Watcher fires before initial fetch returns — must be ignored
    rerenderBranchSwitcher(rerender, 1);

    // invoke must still have been called exactly once (the initial fetch, not a second)
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Resolve the original fetch — branches should appear
    resolveInitial([BRANCH_A, BRANCH_B]);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();
    // Still only one invoke — the skipped refresh must not have fired later
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("keeps last-known branches visible when a watcher refresh fires during a subsequent in-flight fetch", async () => {
    // After the initial load has completed (lastKnownBranchesRef populated), a
    // watcher event triggers a refresh while that fetch is pending. The list must
    // stay visible using the last-known data, not go blank.
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);
    const { rerender } = renderBranchSwitcher(0);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    // Second refresh fires — fetch is pending
    let resolveSecond!: (v: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((res) => { resolveSecond = res; }));
    rerenderBranchSwitcher(rerender, 1);

    // Watcher fires again while second fetch is in-flight — this one CAN fire
    // because lastKnownBranchesRef is now populated (initial load succeeded)
    let resolveThird!: (v: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((res) => { resolveThird = res; }));
    rerenderBranchSwitcher(rerender, 2);

    // Last-known branches must remain visible throughout
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();

    // Resolve the third fetch (second is superseded by generation counter)
    resolveThird([BRANCH_A]);
    await waitFor(() => expect(screen.queryByText("feature/new-ui")).not.toBeInTheDocument());
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("keeps previous branches visible while a listKey-triggered refresh is in flight", async () => {
    // Regression guard: branch list must not go blank between a refresh being
    // triggered and the new list arriving from the backend.
    mockInvoke.mockResolvedValueOnce([BRANCH_A, BRANCH_B]);
    const { rerender } = renderBranchSwitcher(0);

    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    // Trigger refresh — new fetch is pending
    let resolveRefresh!: (v: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((res) => { resolveRefresh = res; }));
    rerenderBranchSwitcher(rerender, 1);

    // Both branches must still be visible while the refresh is in flight
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/new-ui")).toBeInTheDocument();

    // Resolve with an updated list (BRANCH_B renamed)
    const updatedB = { name: "feature/redesign", is_head: false };
    resolveRefresh([BRANCH_A, updatedB]);

    await waitFor(() => expect(screen.getByText("feature/redesign")).toBeInTheDocument());
    expect(screen.queryByText("feature/new-ui")).not.toBeInTheDocument();
  });
});
