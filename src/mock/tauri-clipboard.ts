// Mock for @tauri-apps/plugin-clipboard-manager

export async function writeText(text: string): Promise<void> {
  // Fall back to the browser clipboard API when available.
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}

export async function readText(): Promise<string> {
  if (navigator.clipboard) {
    return navigator.clipboard.readText();
  }
  return "";
}
