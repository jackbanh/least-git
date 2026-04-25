// Mock for @tauri-apps/api/event

type UnlistenFn = () => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listen<T = unknown>(_event: string, _handler: (e: { payload: T }) => void): Promise<UnlistenFn> {
  return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {}
