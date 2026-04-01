import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import CommitList from "../components/CommitList";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../store", () => ({
  useTabStore: vi.fn((selector: (s: object) => unknown) =>
    selector({
      tabs: [{ id: "test-tab", selectedOid: null }],
      selectCommit: vi.fn(),
    })
  ),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const STUB_COMMIT = {
  oid: "abc123def456abc1",
  short_oid: "abc123d",
  summary: "feat: add progress bar",
  author_name: "Jack",
  author_email: "jack@example.com",
  timestamp: 1_700_000_000,
};

function renderCommitList() {
  return render(
    <MantineProvider>
      <CommitList tabId="test-tab" />
    </MantineProvider>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CommitList", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls load_commits on mount — loading guard must not block the initial fetch", async () => {
    // Regression: if isLoading is initialised to `true`, the guard
    // `if (isLoading || !hasMore) return` fires immediately and this call
    // never happens, leaving the component stuck in the loading state.
    mockInvoke.mockResolvedValue([]);

    renderCommitList();

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("load_commits", {
        tabId: "test-tab",
        offset: 0,
        limit: 100,
      });
    });
  });

  it("shows a progress bar while the initial fetch is in flight", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves

    renderCommitList();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("hides the progress bar once commits arrive", async () => {
    mockInvoke.mockResolvedValue([STUB_COMMIT]);

    renderCommitList();

    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("hides the progress bar for an empty repo (hasMore → false)", async () => {
    mockInvoke.mockResolvedValue([]); // returns < PAGE_SIZE, so hasMore → false

    renderCommitList();

    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });
});
