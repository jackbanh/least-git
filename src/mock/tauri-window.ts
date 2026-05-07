// Mock for @tauri-apps/api/window

const noop = () => Promise.resolve();

export function getCurrentWindow() {
  return {
    minimize:       noop,
    maximize:       noop,
    unmaximize:     noop,
    toggleMaximize: noop,
    close:          noop,
    onFocusChanged: (cb: (e: { payload: boolean }) => void) => {
      const handler = () => cb({ payload: document.hasFocus() });
      window.addEventListener("focus", handler);
      window.addEventListener("blur", handler);
      const unlisten = () => {
        window.removeEventListener("focus", handler);
        window.removeEventListener("blur", handler);
      };
      return Promise.resolve(unlisten);
    },
  };
}
