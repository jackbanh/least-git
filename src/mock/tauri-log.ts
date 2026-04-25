// Mock for @tauri-apps/plugin-log

export const trace = (...args: unknown[]) => console.debug("[trace]", ...args);
export const debug = (...args: unknown[]) => console.debug("[debug]", ...args);
export const info  = (...args: unknown[]) => console.info( "[info]",  ...args);
export const warn  = (...args: unknown[]) => console.warn( "[warn]",  ...args);
export const error = (...args: unknown[]) => console.error("[error]", ...args);
