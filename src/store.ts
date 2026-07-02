import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tab {
  id: string;
  path: string;
  name: string;
  selectedOid: string | null;
  listKey: number;
  statusKey: number;
}

interface TabStore {
  tabs: Tab[];
  activeTabId: string | null;
  sidebarWidth: number;
  detailLeftWidth: number;
  detailStagedHeight: number;
  commitBoxExpanded: boolean;
  openTab: (tab: Omit<Tab, "selectedOid" | "listKey" | "statusKey">) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  selectCommit: (tabId: string, oid: string | null) => void;
  bumpListKey: (tabId: string) => void;
  bumpStatusKey: (tabId: string) => void;
  setSidebarWidth: (width: number) => void;
  setDetailLeftWidth: (width: number) => void;
  setDetailStagedHeight: (height: number) => void;
  setCommitBoxExpanded: (expanded: boolean) => void;
}

export const useTabStore = create<TabStore>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,
      sidebarWidth: 360,
      detailLeftWidth: 240,
      detailStagedHeight: 220,
      commitBoxExpanded: true,

      openTab: (tab) =>
        set((state) => {
          if (state.tabs.find((t) => t.id === tab.id)) {
            return { activeTabId: tab.id };
          }
          return {
            tabs: [...state.tabs, { ...tab, selectedOid: null, listKey: 0, statusKey: 0 }],
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
            t.id === tabId ? { ...t, listKey: t.listKey + 1 } : t
          ),
        })),

      bumpStatusKey: (tabId) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, statusKey: t.statusKey + 1 } : t
          ),
        })),

      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      setDetailLeftWidth: (width) => set({ detailLeftWidth: width }),
      setDetailStagedHeight: (height) => set({ detailStagedHeight: height }),
      setCommitBoxExpanded: (expanded) => set({ commitBoxExpanded: expanded }),
    }),
    {
      name: "least-git-tabs",
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          id: t.id,
          path: t.path,
          name: t.name,
          selectedOid: null,
          listKey: 0,
          statusKey: 0,
        })),
        activeTabId: state.activeTabId,
        sidebarWidth: state.sidebarWidth,
        detailLeftWidth: state.detailLeftWidth,
        detailStagedHeight: state.detailStagedHeight,
        commitBoxExpanded: state.commitBoxExpanded,
      }),
    }
  )
);
