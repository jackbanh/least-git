import { create } from "zustand";

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

// Errors linger longer than confirmations so they can be read/copied.
const TTL_MS: Record<ToastKind, number> = { error: 9000, success: 3500, info: 4500 };

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, TTL_MS[t.kind]);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

// Helpers usable from anywhere (including non-React catch blocks).
export function toastError(title: string, err?: unknown) {
  const message = err == null ? undefined : String(err);
  useToastStore.getState().push({ kind: "error", title, message });
}

export function toastSuccess(title: string, message?: string) {
  useToastStore.getState().push({ kind: "success", title, message });
}
