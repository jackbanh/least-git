import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { info as logInfo } from "@tauri-apps/plugin-log";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tabs, Button, Group, Text, useMantineColorScheme } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useTabStore, Tab } from "./store";
import { useGitConfigStore } from "./gitConfigStore";
import { countNotFollowing } from "./gitConfig";
import { useResize } from "./hooks/useResize";
import BranchSwitcher from "./components/BranchSwitcher";
import BranchDialog from "./components/BranchDialog";
import PullDrawer from "./components/PullDrawer";
import GitOutputDrawer from "./components/GitOutputDrawer";
import { type PullRequest } from "./components/Toolbar";
import CommitList from "./components/CommitList";
import CommitDetail from "./components/CommitDetail";
import Toolbar from "./components/Toolbar";
import SettingsModal from "./components/SettingsModal";
import Toasts from "./components/Toasts";
import { toastError } from "./toastStore";
import { platform } from "./lib/platform";
import { createRepoChangedThrottle, type RepoChangedThrottle } from "./lib/repoChangedThrottle";
import "./App.css";

export default function App() {
  const {
    tabs, activeTabId, openTab, closeTab, setActiveTab, bumpListKey, bumpStatusKey,
    sidebarWidth, setSidebarWidth,
  } = useTabStore();

  // Coalesces FS-watcher `repo:changed` bursts into refreshes (created once).
  const repoChangedThrottle = useRef<RepoChangedThrottle>(null);
  if (!repoChangedThrottle.current) {
    repoChangedThrottle.current = createRepoChangedThrottle(2000, (tabId, kind) => {
      if (kind === "refs") bumpListKey(tabId);
      else if (kind === "index") bumpStatusKey(tabId);
    });
  }

  // Git config drives the "needs attention" badges on the toolbar + settings nav.
  const gitConfigValues = useGitConfigStore((s) => s.values);
  const loadGitConfig = useGitConfigStore((s) => s.load);
  useEffect(() => { loadGitConfig(); }, [loadGitConfig]);
  const gcNotFollowing = countNotFollowing(gitConfigValues);

  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [pullDrawerOpen, setPullDrawerOpen] = useState(false);
  const [pullReq, setPullReq] = useState<PullRequest>({ rebase: false });
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [isRebasing, setIsRebasing] = useState(false);
  const [rebaseDrawerOpen, setRebaseDrawerOpen] = useState(false);
  const [rebaseAction, setRebaseAction] = useState<"continue" | "abort">("continue");

  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("lg-theme") as "light" | "dark") ?? "light";
  });
  const [accentHue, setAccentHueState] = useState<number>(() => {
    return parseInt(localStorage.getItem("lg-accent-hue") ?? "155", 10);
  });

  // Keep Mantine's colour scheme in step with the app theme, otherwise Mantine
  // surfaces (Modal, Menu, Switch…) stay light while our tokens go dark.
  const { setColorScheme } = useMantineColorScheme();
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("lg-theme", theme);
    setColorScheme(theme);
  }, [theme, setColorScheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--lg-accent-hue", String(accentHue));
    localStorage.setItem("lg-accent-hue", String(accentHue));
  }, [accentHue]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.setProperty("--lg-accent-hue", String(accentHue));
    // Lets CSS render keyboard-shortcut glyphs in the native font on macOS.
    document.documentElement.setAttribute("data-platform", platform);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTheme(t: "light" | "dark") { setThemeState(t); }
  function setAccentHue(h: number) { setAccentHueState(h); }

  useEffect(() => {
    tabs.forEach((tab) => {
      invoke<Tab>("open_repo", { path: tab.path })
        .then(() => bumpListKey(tab.id))
        .catch(() => closeTab(tab.id));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const throttle = repoChangedThrottle.current!;
    const unlisten = listen<{ tab_id: string; kind: string }>("repo:changed", (e) => {
      const { tab_id, kind } = e.payload;
      const outcome = throttle.handle(tab_id, kind);
      logInfo(`App repo:changed ${outcome} tab=${tab_id} kind=${kind}`);
    });
    return () => {
      unlisten.then((fn) => fn());
      throttle.dispose();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && activeTabId) bumpStatusKey(activeTabId);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [activeTabId, bumpStatusKey]);

  // Primary operations, shared by the macOS native menu, the toolbar, and the
  // Windows/Linux keyboard shortcuts below.
  const doRefresh = useCallback(() => {
    if (!activeTabId) return;
    invoke("clear_detail_cache", { tabId: activeTabId });
    preArmThrottle(activeTabId, "refs");
    bumpListKey(activeTabId);
  }, [activeTabId, bumpListKey]);

  const doBranch = useCallback(() => setBranchDialogOpen(true), []);

  const doPull = useCallback(() => { setPullReq({ rebase: false }); setPullDrawerOpen(true); }, []);

  useEffect(() => {
    const unlisten = listen("menu:refresh", doRefresh);
    return () => { unlisten.then((fn) => fn()); };
  }, [doRefresh]);

  useEffect(() => {
    const unlisten = listen("menu:branch", doBranch);
    return () => { unlisten.then((fn) => fn()); };
  }, [doBranch]);

  useEffect(() => {
    const unlisten = listen("menu:pull", doPull);
    return () => { unlisten.then((fn) => fn()); };
  }, [doPull]);

  // macOS binds these via the native menu (Cmd accelerators). Windows/Linux have
  // no native menu, so bind the same primary operations to the keyboard here.
  useEffect(() => {
    if (platform === "macos") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (e.key === "F5") { e.preventDefault(); doRefresh(); }
      else if (e.ctrlKey && !e.shiftKey && key === "r") { e.preventDefault(); doRefresh(); }
      else if (e.ctrlKey && e.shiftKey && key === "b") { e.preventDefault(); doBranch(); }
      else if (e.ctrlKey && e.shiftKey && key === "p") { e.preventDefault(); doPull(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doRefresh, doBranch, doPull]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  useEffect(() => {
    if (!activeTabId) { setIsRebasing(false); return; }
    invoke<boolean>("get_rebase_status", { tabId: activeTabId })
      .then(setIsRebasing)
      .catch(() => setIsRebasing(false));
  }, [activeTabId, activeTab?.listKey, activeTab?.statusKey]);

  function preArmThrottle(tabId: string, kind: string) {
    repoChangedThrottle.current!.arm(tabId, kind);
    logInfo(`App preArmThrottle tab=${tabId} kind=${kind}`);
  }

  interface BranchInfo { name: string; is_head: boolean; }
  const queryClient = useQueryClient();
  const pullBranchInfo = useMemo(() => {
    const branches = queryClient.getQueryData<BranchInfo[]>(["branches", activeTabId ?? ""]) ?? [];
    const head = branches.find((b) => b.is_head)?.name ?? null;
    return {
      hasMain: branches.some((b) => b.name === "main"),
      hasMaster: branches.some((b) => b.name === "master"),
      headBranch: head,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.listKey, activeTabId, queryClient]);

  const startSidebarResize = useResize(sidebarWidth, setSidebarWidth, "horizontal", 200, 600);

  async function handleOpenFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    try {
      const tab = await invoke<Tab>("open_repo", { path });
      openTab(tab);
    } catch (e) {
      toastError("Couldn't open repository", e);
    }
  }

  return (
    <div className="app-shell">
      <div className={`tab-bar${platform === "macos" ? " tab-bar--macos" : ""}${platform === "windows" ? " tab-bar--windows" : ""}`}>
        {platform === "macos" && (
          <span className="tab-bar-app-title">least-git</span>
        )}
        {platform === "windows" && (
          <span className="win-tab-title" data-tauri-drag-region>least-git</span>
        )}
        <Tabs
          variant="outline"
          value={activeTabId}
          onChange={(v) => v && setActiveTab(v)}
        >
          <Group gap={0} wrap="nowrap" align="flex-end">
            <Tabs.List style={{ flexShrink: 0, borderBottom: "none" }}>
              {tabs.map((tab) => (
                <Tabs.Tab key={tab.id} value={tab.id}>
                  <span className="tab-label">{tab.name}</span>
                  <span
                    className="tab-close"
                    role="button"
                    tabIndex={0}
                    aria-label={`Close ${tab.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      invoke("close_tab", { tabId: tab.id });
                      closeTab(tab.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        invoke("close_tab", { tabId: tab.id });
                        closeTab(tab.id);
                      }
                    }}
                  >
                    ✕
                  </span>
                </Tabs.Tab>
              ))}
            </Tabs.List>
            <button
              className="tab-bar-new-btn"
              onClick={handleOpenFolder}
              title="Open repo…"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </Group>
        </Tabs>
        <div className="tab-bar-drag-region" data-tauri-drag-region />
        {platform === "windows" && (
          <div className="win-controls">
            <button
              className="win-controls-btn"
              onClick={() => getCurrentWindow().minimize()}
              aria-label="Minimize"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
              </svg>
            </button>
            <button
              className="win-controls-btn"
              onClick={() => getCurrentWindow().toggleMaximize()}
              aria-label="Maximize"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            </button>
            <button
              className="win-controls-btn win-controls-btn--close"
              onClick={() => getCurrentWindow().close()}
              aria-label="Close"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <Toolbar
        pullBranchInfo={pullBranchInfo}
        isRebasing={isRebasing}
        onPull={(req) => { setPullReq(req); setPullDrawerOpen(true); }}
        onBranch={doBranch}
        onRefresh={doRefresh}
        onRebaseContinue={() => { setRebaseAction("continue"); setRebaseDrawerOpen(true); }}
        onRebaseAbort={() => { setRebaseAction("abort"); setRebaseDrawerOpen(true); }}
        onToggleTweaks={() => setTweaksOpen((o) => !o)}
        settingsBadge={gcNotFollowing}
      />

      <div className="workspace">
        {activeTabId ? (
          <>
            {/* Left sidebar: branch dropdown + commit list */}
            <div className="sidebar-column" style={{ width: sidebarWidth }}>
              <BranchSwitcher
                tabId={activeTabId}
                listKey={activeTab?.listKey ?? 0}
                onManualRefresh={() => preArmThrottle(activeTabId, "refs")}
              />
              <CommitList
                key={activeTabId}
                tabId={activeTabId}
                listKey={activeTab?.listKey ?? 0}
              />
            </div>

            <div className="resize-handle resize-handle--vertical" onMouseDown={startSidebarResize} />

            {/* Right content: commit detail fills full height */}
            <div className="main-content">
              <CommitDetail
                tabId={activeTabId}
                listKey={activeTab?.listKey ?? 0}
                statusKey={activeTab?.statusKey ?? 0}
              />
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Text c="dimmed" mb="md">
              No repositories open
            </Text>
            <Button onClick={handleOpenFolder}>Open a Repository</Button>
          </div>
        )}
      </div>

      {activeTabId && (
        <BranchDialog
          tabId={activeTabId}
          opened={branchDialogOpen}
          onClose={() => setBranchDialogOpen(false)}
          onCreated={() => { preArmThrottle(activeTabId, "refs"); bumpListKey(activeTabId); }}
        />
      )}
      {activeTabId && (
        <PullDrawer
          tabId={activeTabId}
          opened={pullDrawerOpen}
          target={pullReq.target}
          rebase={pullReq.rebase}
          onClose={() => setPullDrawerOpen(false)}
          onSuccess={() => { preArmThrottle(activeTabId, "refs"); bumpListKey(activeTabId); }}
        />
      )}

      {activeTabId && (
        <GitOutputDrawer
          tabId={activeTabId}
          opened={rebaseDrawerOpen}
          title={rebaseAction === "continue" ? "Continue Rebase" : "Abort Rebase"}
          command={rebaseAction === "continue" ? "continue_rebase" : "abort_rebase"}
          commandArgs={{}}
          eventPrefix="rebase"
          displayCommand={rebaseAction === "continue" ? "git rebase --continue" : "git rebase --abort"}
          onClose={() => setRebaseDrawerOpen(false)}
          onSuccess={() => {
            preArmThrottle(activeTabId, "refs");
            bumpListKey(activeTabId);
            bumpStatusKey(activeTabId);
          }}
        />
      )}

      <SettingsModal
        opened={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        theme={theme}
        setTheme={setTheme}
        accentHue={accentHue}
        setAccentHue={setAccentHue}
      />

      <Toasts />
    </div>
  );
}
