import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import WorkingTreeDetail from "../components/WorkingTreeDetail";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("../components/InteractiveDiffViewer", () => ({ default: () => <div>diff</div> }));
vi.mock("../hooks/useResize", () => ({ useResize: () => vi.fn() }));
// Mutable so tests can bump untrackedKey; the selector re-runs on every render,
// so mutate then rerender to simulate a store update.
const mockStore = vi.hoisted(() => ({
  state: {
    detailLeftWidth: 220,
    setDetailLeftWidth: () => {},
    detailStagedHeight: 220,
    setDetailStagedHeight: () => {},
    commitBoxExpanded: false,
    setCommitBoxExpanded: () => {},
    bumpListKey: () => {},
    tabs: [{ id: "test-tab", untrackedKey: 0 }],
  },
}));
function setUntrackedKey(key: number) {
  mockStore.state.tabs = [{ id: "test-tab", untrackedKey: key }];
}
vi.mock("../store", () => ({
  useTabStore: vi.fn((selector: (s: object) => unknown) => selector(mockStore.state)),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const STUB_STATUS = {
  head_branch: "main",
  staged:   [
    { path: "src/staged1.ts",   old_path: null, status: "M", is_conflict: false },
    { path: "src/staged2.ts",   old_path: null, status: "A", is_conflict: false },
  ],
  unstaged: [
    { path: "src/unstaged1.ts", old_path: null, status: "M", is_conflict: false },
  ],
};

function renderWTD(props: { listKey?: number; statusKey?: number } = {}) {
  const { listKey = 0, statusKey = 0 } = props;
  const result = render(
    <MantineProvider>
      <WorkingTreeDetail tabId="test-tab" listKey={listKey} statusKey={statusKey} />
    </MantineProvider>
  );
  return {
    ...result,
    setKeys: (next: { listKey?: number; statusKey?: number }) =>
      result.rerender(
        <MantineProvider>
          <WorkingTreeDetail
            tabId="test-tab"
            listKey={next.listKey ?? listKey}
            statusKey={next.statusKey ?? statusKey}
          />
        </MantineProvider>
      ),
  };
}

function callsTo(cmd: string) {
  return mockInvoke.mock.calls.filter(([c]) => c === cmd).length;
}

// FileRow renders the path split across dir/name spans, with title={path} on the
// wrapper span. Use getByTitle to locate rows without depending on text splitting.
function getFilePath(path: string) {
  return screen.getByTitle(path);
}

describe("WorkingTreeDetail error state", () => {
  it("shows the error message when get_working_tree_status fails", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_working_tree_status")
        return Promise.reject("git status failed: error: unknown option `no-renames'");
      return Promise.resolve([]);
    });
    renderWTD();
    await waitFor(() =>
      expect(screen.getByText(/git status failed/)).toBeInTheDocument()
    );
    // The pane spinner must not still be present once the error is shown —
    // isLoading is gated on !statusError, so an error replaces it rather than
    // sitting under it.
    //
    // Scope this to .wt-spinner-footer rather than matching .mantine-Loader-root
    // globally. The Scan button is a second, unrelated loader tied to
    // untrackedLoading, which is legitimately still true here — a tracked-status
    // failure doesn't cancel the untracked scan. Worse, Mantine mounts that
    // loader through a transition, so .mantine-Loader-root appears a beat after
    // the button flips to data-loading="true". The global selector therefore
    // raced that mount and failed only on CI, where the assertion landed on the
    // far side of it.
    expect(document.querySelector(".wt-spinner-footer")).toBeNull();
  });
});

describe("WorkingTreeDetail file list keyboard navigation", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_working_tree_status") return Promise.resolve(STUB_STATUS);
      if (cmd === "get_untracked_files") return Promise.resolve([]);
      return Promise.resolve(""); // staged/unstaged diff
    });
  });

  async function setup() {
    renderWTD();
    await waitFor(() => expect(getFilePath("src/staged1.ts")).toBeInTheDocument());
  }

  function fileList() {
    return document.querySelector(".detail-files-panes") as HTMLElement;
  }

  it("focuses the file list when a file row is clicked", async () => {
    await setup();
    fireEvent.click(getFilePath("src/staged1.ts"));
    expect(document.activeElement).toBe(fileList());
  });

  it("moves selection down with ArrowDown within staged section", async () => {
    await setup();
    fireEvent.click(getFilePath("src/staged1.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowDown" });

    await waitFor(() =>
      expect(getFilePath("src/staged2.ts").closest(".file-tree-file")).toHaveClass("file-tree-file--selected")
    );
  });

  it("moves selection from last staged to first unstaged with ArrowDown", async () => {
    await setup();
    fireEvent.click(getFilePath("src/staged2.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowDown" });

    await waitFor(() =>
      expect(getFilePath("src/unstaged1.ts").closest(".file-tree-file")).toHaveClass("file-tree-file--selected")
    );
  });

  it("moves selection from first unstaged back to last staged with ArrowUp", async () => {
    await setup();
    fireEvent.click(getFilePath("src/unstaged1.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowUp" });

    await waitFor(() =>
      expect(getFilePath("src/staged2.ts").closest(".file-tree-file")).toHaveClass("file-tree-file--selected")
    );
  });

  it("does not move past the first file on ArrowUp", async () => {
    await setup();
    fireEvent.click(getFilePath("src/staged1.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowUp" });

    await waitFor(() =>
      expect(getFilePath("src/staged1.ts").closest(".file-tree-file")).toHaveClass("file-tree-file--selected")
    );
  });

  it("does not move past the last file on ArrowDown", async () => {
    await setup();
    fireEvent.click(getFilePath("src/unstaged1.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowDown" });

    await waitFor(() =>
      expect(getFilePath("src/unstaged1.ts").closest(".file-tree-file")).toHaveClass("file-tree-file--selected")
    );
  });
});

describe("WorkingTreeDetail refresh behaviour", () => {
  beforeEach(() => {
    setUntrackedKey(0);
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_working_tree_status") return Promise.resolve(STUB_STATUS);
      if (cmd === "get_untracked_files") return Promise.resolve(["src/new.ts"]);
      return Promise.resolve("");
    });
  });

  // Three effects (tabId, listKey, statusKey) all used to fire on mount, sending
  // three identical refreshes at once. On a large monorepo the resulting
  // concurrent `git status` runs contend and take ~2x as long as a single one.
  it("issues exactly one status refresh on mount", async () => {
    renderWTD();
    await waitFor(() => expect(getFilePath("src/new.ts")).toBeInTheDocument());

    expect(callsTo("get_working_tree_status")).toBe(1);
    expect(callsTo("get_untracked_files")).toBe(1);
  });

  // #4: the untracked walk costs 5-9s on a large monorepo and nothing a listKey
  // or statusKey event represents (branch switch, commit, stage, unstage) can
  // create an untracked file. Only untrackedKey asks for a rescan.
  it("refreshes tracked changes on listKey change without rescanning untracked", async () => {
    const { setKeys } = renderWTD();
    await waitFor(() => expect(getFilePath("src/new.ts")).toBeInTheDocument());

    setKeys({ listKey: 1 });
    await waitFor(() => expect(callsTo("get_working_tree_status")).toBe(2));
    expect(callsTo("get_untracked_files")).toBe(1);
  });

  it("refreshes tracked changes on statusKey change without rescanning untracked", async () => {
    const { setKeys } = renderWTD();
    await waitFor(() => expect(getFilePath("src/new.ts")).toBeInTheDocument());

    setKeys({ statusKey: 1 });
    await waitFor(() => expect(callsTo("get_working_tree_status")).toBe(2));
    expect(callsTo("get_untracked_files")).toBe(1);
  });

  it("rescans untracked when untrackedKey bumps (window focus, explicit refresh)", async () => {
    const { setKeys } = renderWTD();
    await waitFor(() => expect(getFilePath("src/new.ts")).toBeInTheDocument());

    setUntrackedKey(1);
    setKeys({});

    await waitFor(() => expect(callsTo("get_untracked_files")).toBe(2));
    // Tracked status is not re-fetched — this signal is about new files only.
    expect(callsTo("get_working_tree_status")).toBe(1);
  });

  it("rescans untracked when the Scan button is clicked", async () => {
    renderWTD();
    await waitFor(() => expect(getFilePath("src/new.ts")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Scan for new files"));

    await waitFor(() => expect(callsTo("get_untracked_files")).toBe(2));
  });

  // The untracked scan takes seconds on a large monorepo; blanking the list for
  // that long on every rescan flickers.
  it("keeps untracked files on screen while a rescan is in flight", async () => {
    const { setKeys } = renderWTD();
    await waitFor(() => expect(getFilePath("src/new.ts")).toBeInTheDocument());

    // Rescan that never settles, standing in for a slow walk.
    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_working_tree_status") return Promise.resolve(STUB_STATUS);
      if (cmd === "get_untracked_files") return new Promise(() => {});
      return Promise.resolve("");
    });
    setUntrackedKey(1);
    setKeys({});

    await waitFor(() => expect(callsTo("get_untracked_files")).toBe(1));
    expect(getFilePath("src/new.ts")).toBeInTheDocument();
  });

  // A coalesced scan can return a list assembled before the file was staged; the
  // tracked status is never coalesced, so it wins.
  it("drops untracked entries that the tracked status already reports", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_working_tree_status") return Promise.resolve(STUB_STATUS);
      // Stale scan still lists a file that is now staged.
      if (cmd === "get_untracked_files") return Promise.resolve(["src/staged1.ts"]);
      return Promise.resolve("");
    });
    renderWTD();
    await waitFor(() => expect(getFilePath("src/staged1.ts")).toBeInTheDocument());

    expect(screen.getAllByTitle("src/staged1.ts")).toHaveLength(1);
  });

  // Deleting is the case the tracked-status filter can't cover: a deleted file
  // is absent from tracked status too, so a stale scan would resurrect it.
  it("discards a scan result for a file deleted while the scan was running", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveScan!: (paths: string[]) => void;
    renderWTD();
    await waitFor(() => expect(getFilePath("src/new.ts")).toBeInTheDocument());

    // Second scan is in flight and will come back still listing the file.
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_working_tree_status") return Promise.resolve(STUB_STATUS);
      if (cmd === "get_untracked_files") return new Promise((res) => { resolveScan = res; });
      return Promise.resolve(undefined);
    });
    fireEvent.click(screen.getByLabelText("Scan for new files"));
    await waitFor(() => expect(resolveScan).toBeDefined());

    // Delete it mid-scan (Ctrl+Delete on the selected untracked file).
    const panes = document.querySelector(".detail-files-panes") as HTMLElement;
    fireEvent.click(getFilePath("src/new.ts"));
    fireEvent.keyDown(panes, { key: "Delete", ctrlKey: true });
    await waitFor(() => expect(screen.queryByTitle("src/new.ts")).not.toBeInTheDocument());

    resolveScan(["src/new.ts"]); // pre-deletion data
    await waitFor(() => expect(callsTo("delete_untracked")).toBe(1));

    expect(screen.queryByTitle("src/new.ts")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("keeps the previous list when a rescan fails", async () => {
    renderWTD();
    await waitFor(() => expect(getFilePath("src/new.ts")).toBeInTheDocument());

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_working_tree_status") return Promise.resolve(STUB_STATUS);
      if (cmd === "get_untracked_files") return Promise.reject(new Error("tab not found"));
      return Promise.resolve("");
    });
    fireEvent.click(screen.getByLabelText("Scan for new files"));

    await waitFor(() => expect(callsTo("get_untracked_files")).toBe(2));
    expect(getFilePath("src/new.ts")).toBeInTheDocument();
  });
});
