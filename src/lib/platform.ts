export type Platform = "windows" | "macos" | "linux";

// Mirrors the detection used for window chrome. In browser-mock mode
// (__TAURI_INTERNALS__ absent) we default to "windows" so the non-macOS
// keyboard path and Ctrl-style hints are exercised during preview.
export const platform: Platform = (() => {
  if (!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return "windows";
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Mac")) return "macos";
  return "linux";
})();

export const isMac = platform === "macos";

/**
 * Human-readable shortcut label for the current platform.
 * mac:   ⌘D, ⇧⌘B, ⌘Enter   ·   other: Ctrl+D, Ctrl+Shift+B, Ctrl+Enter
 * Non-mac spells the modifiers out (Ctrl / Shift), which reads more clearly
 * for non-native English speakers than symbols do.
 */
export function shortcutLabel(key: string, opts?: { shift?: boolean }): string {
  if (isMac) return `${opts?.shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${opts?.shift ? "Shift+" : ""}${key}`;
}

// "+" and Delete don't render cleanly through shortcutLabel ("Ctrl++"), so their
// labels are special-cased here and shared between the menu hints and the
// Settings reference list to keep them in sync.
export const plusShortcut = isMac ? "⌘+" : "Ctrl+Plus";
export const deleteShortcut = isMac ? "⌘⌫" : "Ctrl+Del";
