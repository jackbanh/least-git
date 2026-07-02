// Shared git-global config state. Lives outside components so the Settings rows,
// the Settings nav badge, and the toolbar button badge all read the same values
// and update together when a switch is toggled.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { CONFIG_KEYS } from "./gitConfig";

interface GitConfigStore {
  /** null = not loaded yet; otherwise key → stored value (or null when unset). */
  values: Record<string, string | null> | null;
  load: () => Promise<void>;
  /** Optimistically write one key, reverting if the backend call fails. */
  setValue: (key: string, value: string | null) => Promise<void>;
}

export const useGitConfigStore = create<GitConfigStore>((set, get) => ({
  values: null,

  load: async () => {
    try {
      const v = await invoke<Record<string, string | null>>("get_git_config_globals", {
        keys: CONFIG_KEYS,
      });
      set({ values: v });
    } catch {
      set({ values: {} });
    }
  },

  setValue: async (key, value) => {
    const prev = get().values;
    set({ values: { ...(prev ?? {}), [key]: value } });
    try {
      await invoke("set_git_config_global", { key, value });
    } catch {
      set({ values: prev }); // revert on failure
    }
  },
}));
