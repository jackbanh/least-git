import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CommitDetail, { UNCOMMITTED } from "../components/CommitDetail";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => <p>{children}</p> }));
vi.mock("../components/DiffViewer", () => ({ default: () => <div>diff</div> }));
vi.mock("../components/WorkingTreeDetail", () => ({ default: () => <div>working tree</div> }));
vi.mock("../hooks/useResize", () => ({ useResize: () => () => {} }));

const mockSelectedOid = vi.fn(() => "abc123");

vi.mock("../store", () => ({
  useTabStore: vi.fn((selector: (s: object) => unknown) =>
    selector({
      tabs: [{ id: "test-tab", selectedOid: mockSelectedOid() }],
      selectCommit: vi.fn(),
    })
  ),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const STUB_DETAIL = {
  oid: "abc123def456",
  summary: "feat: add thing",
  body: "",
  author_name: "Jack",
  author_email: "jack@example.com",
  timestamp: 1_700_000_000,
  files: [
    { path: "src/alpha.ts", old_path: null, status: "M" },
    { path: "src/beta.ts",  old_path: null, status: "M" },
    { path: "src/gamma.ts", old_path: null, status: "A" },
  ],
};

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <CommitDetail tabId="test-tab" listKey={0} statusKey={0} />
      </MantineProvider>
    </QueryClientProvider>
  );
}

// File paths are split into dir/name spans; match by title attribute on the wrapper.
function getFilePath(path: string) {
  return screen.getByTitle(path);
}

describe("CommitDetail file list keyboard navigation", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSelectedOid.mockReturnValue("abc123");
  });

  async function setup() {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_commit_detail") return Promise.resolve(STUB_DETAIL);
      return Promise.resolve(""); // get_file_diff
    });
    renderDetail();
    await waitFor(() => expect(getFilePath("src/alpha.ts")).toBeInTheDocument());
  }

  it("focuses the file list when a file row is clicked", async () => {
    await setup();

    fireEvent.click(getFilePath("src/alpha.ts"));

    const fileList = document.querySelector(".detail-files") as HTMLElement;
    expect(document.activeElement).toBe(fileList);
  });

  it("moves selection down with ArrowDown after clicking a file", async () => {
    await setup();

    fireEvent.click(getFilePath("src/alpha.ts"));

    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowDown" });

    await waitFor(() =>
      expect(getFilePath("src/beta.ts").closest(".file-tree-file")).toHaveClass("file-tree-file--selected")
    );
  });

  it("moves selection up with ArrowUp", async () => {
    await setup();

    fireEvent.click(getFilePath("src/beta.ts"));
    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowUp" });

    await waitFor(() =>
      expect(getFilePath("src/alpha.ts").closest(".file-tree-file")).toHaveClass("file-tree-file--selected")
    );
  });

  it("navigates from first file to description row on ArrowUp", async () => {
    await setup();

    fireEvent.click(getFilePath("src/alpha.ts"));
    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowUp" });

    await waitFor(() =>
      expect(document.querySelector(".description-row")).toHaveClass("file-row--selected")
    );
  });

  it("does not move past the description row on ArrowUp", async () => {
    await setup();

    // Description row is selected by default; pressing ArrowUp should keep it selected.
    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowUp" });

    await waitFor(() =>
      expect(document.querySelector(".description-row")).toHaveClass("file-row--selected")
    );
  });

  it("does not move past the last file on ArrowDown", async () => {
    await setup();

    fireEvent.click(getFilePath("src/gamma.ts"));
    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowDown" });

    await waitFor(() =>
      expect(getFilePath("src/gamma.ts").closest(".file-tree-file")).toHaveClass("file-tree-file--selected")
    );
  });
});

describe("CommitDetail UNCOMMITTED routing", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSelectedOid.mockReturnValue(UNCOMMITTED);
  });

  it("renders WorkingTreeDetail and not CommitDetailInner when selectedOid is UNCOMMITTED", async () => {
    renderDetail();
    // WorkingTreeDetail mock renders "working tree"; this should appear immediately.
    await waitFor(() => expect(screen.getByText("working tree")).toBeInTheDocument());
  });

  it("does not call get_commit_detail when selectedOid is UNCOMMITTED", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText("working tree")).toBeInTheDocument());
    expect(mockInvoke).not.toHaveBeenCalledWith("get_commit_detail", expect.anything());
  });
});
