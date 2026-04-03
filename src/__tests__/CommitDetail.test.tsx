import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import CommitDetail from "../components/CommitDetail";

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
  return render(<CommitDetail tabId="test-tab" />);
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
    await waitFor(() => expect(screen.getByText("src/alpha.ts")).toBeInTheDocument());
  }

  it("focuses the file list when a file row is clicked", async () => {
    await setup();

    fireEvent.click(screen.getByText("src/alpha.ts"));

    const fileList = document.querySelector(".detail-files") as HTMLElement;
    expect(document.activeElement).toBe(fileList);
  });

  it("moves selection down with ArrowDown after clicking a file", async () => {
    await setup();

    fireEvent.click(screen.getByText("src/alpha.ts"));

    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowDown" });

    await waitFor(() =>
      expect(screen.getByText("src/beta.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });

  it("moves selection up with ArrowUp", async () => {
    await setup();

    fireEvent.click(screen.getByText("src/beta.ts"));
    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowUp" });

    await waitFor(() =>
      expect(screen.getByText("src/alpha.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });

  it("does not move past the first file on ArrowUp", async () => {
    await setup();

    fireEvent.click(screen.getByText("src/alpha.ts"));
    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowUp" });

    await waitFor(() =>
      expect(screen.getByText("src/alpha.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });

  it("does not move past the last file on ArrowDown", async () => {
    await setup();

    fireEvent.click(screen.getByText("src/gamma.ts"));
    const fileList = document.querySelector(".detail-files") as HTMLElement;
    fireEvent.keyDown(fileList, { key: "ArrowDown" });

    await waitFor(() =>
      expect(screen.getByText("src/gamma.ts").closest(".file-row")).toHaveClass("file-row--selected")
    );
  });
});
