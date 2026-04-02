import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import CommitList from "../components/CommitList";

// Mock the virtualizer to render ALL items regardless of container size.
// jsdom has no layout engine so getBoundingClientRect returns zeros, which
// causes the real virtualizer to render nothing. This mock lets us query the
// DOM for duplicate rows.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: i,
        start: i * estimateSize(),
        size: estimateSize(),
      })),
  }),
}));

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

  it("renders each commit exactly once — no duplicates from concurrent fetches", async () => {
    // Regression: isLoading state (async) allowed two concurrent loadMore calls
    // with the same offset, causing setCommits to append the same page twice.
    // Fixed by using a ref guard (synchronous) instead.
    const commits = [
      { ...STUB_COMMIT, oid: "aaa111", short_oid: "aaa111", summary: "first commit" },
      { ...STUB_COMMIT, oid: "bbb222", short_oid: "bbb222", summary: "second commit" },
      { ...STUB_COMMIT, oid: "ccc333", short_oid: "ccc333", summary: "third commit" },
    ];
    mockInvoke.mockResolvedValue(commits); // < PAGE_SIZE → hasMore becomes false

    renderCommitList();

    await waitFor(() => {
      expect(screen.getByText("first commit")).toBeInTheDocument();
    });

    // Each summary must appear exactly once — duplicates would mean the page
    // was appended more than once.
    expect(screen.getAllByText("first commit")).toHaveLength(1);
    expect(screen.getAllByText("second commit")).toHaveLength(1);
    expect(screen.getAllByText("third commit")).toHaveLength(1);

    // invoke should have been called exactly once (offset 0 only)
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("load_commits", {
      tabId: "test-tab",
      offset: 0,
      limit: 100,
    });
  });
});
