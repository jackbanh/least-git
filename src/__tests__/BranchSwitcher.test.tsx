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
