import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tab {
  id: string;
  path: string;
  name: string;
  selectedOid: string | null;
  listKey: number;
}

interface TabStore {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Omit<Tab, "selectedOid" | "listKey">) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  selectCommit: (tabId: string, oid: string | null) => void;
  bumpListKey: (tabId: string) => void;
}

export const useTabStore = create<TabStore>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,

      openTab: (tab) =>
        set((state) => {
          if (state.tabs.find((t) => t.id === tab.id)) {
            return { activeTabId: tab.id };
          }
          return {
            tabs: [...state.tabs, { ...tab, selectedOid: null, listKey: 0 }],
            activeTabId: tab.id,
          };
        }),

      closeTab: (id) =>
        set((state) => {
          const tabs = state.tabs.filter((t) => t.id !== id);
          const activeTabId =
            state.activeTabId === id
              ? (tabs[tabs.length - 1]?.id ?? null)
              : state.activeTabId;
          return { tabs, activeTabId };
        }),

      setActiveTab: (id) => set({ activeTabId: id }),

      selectCommit: (tabId, oid) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, selectedOid: oid } : t
          ),
        })),

      bumpListKey: (tabId) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, listKey: t.listKey + 1, selectedOid: null } : t
          ),
        })),
    }),
    {
      name: "least-git-tabs",
      // Only persist the tab list and active tab — not transient state
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          id: t.id,
          path: t.path,
          name: t.name,
          selectedOid: null,
          listKey: 0,
        })),
        activeTabId: state.activeTabId,
      }),
    }
  )
);
