// Mock for @tauri-apps/api/window

const noop = () => Promise.resolve();

export function getCurrentWindow() {
  return {
    minimize:       noop,
    maximize:       noop,
    unmaximize:     noop,
    toggleMaximize: noop,
    close:          noop,
  };
}
