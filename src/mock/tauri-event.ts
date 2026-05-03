// Mock for @tauri-apps/api/event

type UnlistenFn = () => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (e: { payload: any }) => void;

const registry = new Map<string, Set<Handler>>();

export async function listen<T = unknown>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!registry.has(event)) registry.set(event, new Set());
  registry.get(event)!.add(handler as Handler);
  return () => { registry.get(event)?.delete(handler as Handler); };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  dispatchMockEvent(event, payload);
}

export function dispatchMockEvent(event: string, payload: unknown): void {
  registry.get(event)?.forEach((h) => h({ payload }));
}
