// Mock for @tauri-apps/plugin-dialog
// Always "selects" the mock repo path so clicking Open Folder works.

import { MOCK_TAB_PATH } from "./fixtures";

export async function open(_opts?: unknown): Promise<string | null> {
  return MOCK_TAB_PATH;
}
