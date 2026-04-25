// Mock for @tauri-apps/plugin-window-state

export async function restoreStateCurrent(_flags?: number): Promise<void> {}
export async function saveWindowState(_flags?: number): Promise<void> {}
export async function restoreState(_label: string, _flags?: number): Promise<void> {}
