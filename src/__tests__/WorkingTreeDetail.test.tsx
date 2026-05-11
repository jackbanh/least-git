import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import WorkingTreeDetail from "../components/WorkingTreeDetail";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("../components/InteractiveDiffViewer", () => ({ default: () => <div>diff</div> }));
vi.mock("../hooks/useResize", () => ({ useResize: () => vi.fn() }));
vi.mock("../store", () => ({
  useTabStore: vi.fn((selector: (s: object) => unknown) =>
    selector({
      detailLeftWidth: 220,
      setDetailLeftWidth: vi.fn(),
    })
  ),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const STUB_STATUS = {
  staged:   [
    { path: "src/staged1.ts",   old_path: null, status: "M", is_conflict: false },
    { path: "src/staged2.ts",   old_path: null, status: "A", is_conflict: false },
  ],
  unstaged: [
    { path: "src/unstaged1.ts", old_path: null, status: "M", is_conflict: false },
  ],
};

function renderWTD() {
  return render(
    <MantineProvider>
      <WorkingTreeDetail tabId="test-tab" listKey={0} statusKey={0} />
    </MantineProvider>
  );
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
    // The spinner must not still be present once the error is shown
    expect(document.querySelector(".mantine-Loader-root")).toBeNull();
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
    return document.querySelector(".detail-files") as HTMLElement;
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
      expect(getFilePath("src/staged2.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });

  it("moves selection from last staged to first unstaged with ArrowDown", async () => {
    await setup();
    fireEvent.click(getFilePath("src/staged2.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowDown" });

    await waitFor(() =>
      expect(getFilePath("src/unstaged1.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });

  it("moves selection from first unstaged back to last staged with ArrowUp", async () => {
    await setup();
    fireEvent.click(getFilePath("src/unstaged1.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowUp" });

    await waitFor(() =>
      expect(getFilePath("src/staged2.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });

  it("does not move past the first file on ArrowUp", async () => {
    await setup();
    fireEvent.click(getFilePath("src/staged1.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowUp" });

    await waitFor(() =>
      expect(getFilePath("src/staged1.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });

  it("does not move past the last file on ArrowDown", async () => {
    await setup();
    fireEvent.click(getFilePath("src/unstaged1.ts"));
    fireEvent.keyDown(fileList(), { key: "ArrowDown" });

    await waitFor(() =>
      expect(getFilePath("src/unstaged1.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });
});
