import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { info as logInfo } from "@tauri-apps/plugin-log";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tabs, Button, ActionIcon, Group, Text } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import { useTabStore, Tab } from "./store";
import { useResize } from "./hooks/useResize";
import BranchSwitcher from "./components/BranchSwitcher";
import BranchDialog from "./components/BranchDialog";
import PullDrawer, { type PullTarget } from "./components/PullDrawer";
import CommitList from "./components/CommitList";
import CommitDetail from "./components/CommitDetail";
import Toolbar from "./components/Toolbar";
import TweaksPanel from "./components/TweaksPanel";
import "./App.css";

// Detected once at module load — stable for the lifetime of the app.
// In browser mock mode (no Tauri context) default to "windows" so the
// Windows chrome is visible for styling work.
const platform = (() => {
  if (!(window as any).__TAURI_INTERNALS__) return "windows";
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Mac")) return "macos";
  return "linux";
})();

export default function App() {
  const {
    tabs, activeTabId, openTab, closeTab, setActiveTab, bumpListKey, bumpStatusKey,
    sidebarWidth, setSidebarWidth, detailHeight, setDetailHeight,
  } = useTabStore();

  const repoChangedThrottle = useRef<Record<string, number>>({});

  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [pullDrawerOpen, setPullDrawerOpen] = useState(false);
  const [pullTarget, setPullTarget] = useState<PullTarget | undefined>(undefined);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // Theme state
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("lg-theme") as "light" | "dark") ?? "light";
  });
  const [accentHue, setAccentHueState] = useState<number>(() => {
    return parseInt(localStorage.getItem("lg-accent-hue") ?? "155", 10);
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("lg-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--lg-accent-hue", String(accentHue));
    localStorage.setItem("lg-accent-hue", String(accentHue));
  }, [accentHue]);

  // Apply initial theme immediately (avoids flash)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.setProperty("--lg-accent-hue", String(accentHue));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTheme(t: "light" | "dark") {
    setThemeState(t);
  }
  function setAccentHue(h: number) {
    setAccentHueState(h);
  }

  // Re-register persisted tabs with Rust on startup.
  useEffect(() => {
    tabs.forEach((tab) => {
      invoke<Tab>("open_repo", { path: tab.path })
        .then(() => bumpListKey(tab.id))
        .catch(() => closeTab(tab.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlisten = listen<{ tab_id: string; kind: string }>("repo:changed", (e) => {
      const { tab_id, kind } = e.payload;
      const key = `${tab_id}:${kind}`;
      const now = Date.now();
      const COOLDOWN_MS = 2000;
      const sinceLastMs = now - (repoChangedThrottle.current[key] ?? 0);
      if (sinceLastMs < COOLDOWN_MS) {
        logInfo(`App repo:changed throttled tab=${tab_id} kind=${kind} sinceLastMs=${sinceLastMs}`);
        return;
      }
      repoChangedThrottle.current[key] = now;
      logInfo(`App repo:changed dispatching tab=${tab_id} kind=${kind}`);

      if (kind === "refs") {
        bumpListKey(tab_id);
      } else if (kind === "index") {
        bumpStatusKey(tab_id);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlisten = listen("menu:refresh", () => {
      if (activeTabId) {
        invoke("clear_detail_cache", { tabId: activeTabId });
        preArmThrottle(activeTabId, "refs");
        bumpListKey(activeTabId);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [activeTabId, bumpListKey]);

  useEffect(() => {
    const unlisten = listen("menu:branch", () => setBranchDialogOpen(true));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    // macOS menu bar pulls current branch (no explicit target)
    const unlisten = listen("menu:pull", () => { setPullTarget(undefined); setPullDrawerOpen(true); });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  function preArmThrottle(tabId: string, kind: string) {
    const key = `${tabId}:${kind}`;
    repoChangedThrottle.current[key] = Date.now();
    logInfo(`App preArmThrottle tab=${tabId} kind=${kind}`);
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const startSidebarResize = useResize(sidebarWidth, setSidebarWidth, "horizontal", 150, 500);
  const startDetailResize = useResize(detailHeight, setDetailHeight, "vertical", 120, 600, true);

  async function handleOpenFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    try {
      const tab = await invoke<Tab>("open_repo", { path });
      openTab(tab);
    } catch (e) {
      console.error("Failed to open repo:", e);
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
                  <ActionIcon
                    size={14}
                    variant="transparent"
                    c="dimmed"
                    style={{ marginLeft: 6, color: "inherit", opacity: 0.6 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      invoke("close_tab", { tabId: tab.id });
                      closeTab(tab.id);
                    }}
                    aria-label={`Close ${tab.name}`}
                  >
                    ✕
                  </ActionIcon>
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
        onPull={(target) => { setPullTarget(target); setPullDrawerOpen(true); }}
        onBranch={() => setBranchDialogOpen(true)}
        onRefresh={() => {
          if (activeTabId) {
            invoke("clear_detail_cache", { tabId: activeTabId });
            preArmThrottle(activeTabId, "refs");
            bumpListKey(activeTabId);
          }
        }}
        onToggleTweaks={() => setTweaksOpen((o) => !o)}
      />

      <div className="workspace">
        {activeTabId ? (
          <>
            <div className="sidebar" style={{ width: sidebarWidth }}>
              <BranchSwitcher
                tabId={activeTabId}
                listKey={activeTab?.listKey ?? 0}
                onManualRefresh={() => preArmThrottle(activeTabId, "refs")}
              />
            </div>
            <div className="resize-handle resize-handle--vertical" onMouseDown={startSidebarResize} />
            <div className="main-area">
              <div className="commit-list-pane">
                <CommitList
                  key={activeTabId}
                  tabId={activeTabId}
                  listKey={activeTab?.listKey ?? 0}
                />
              </div>
              <div className="resize-handle resize-handle--horizontal" onMouseDown={startDetailResize} />
              <div className="detail-pane" style={{ height: detailHeight }}>
                <CommitDetail tabId={activeTabId} listKey={activeTab?.listKey ?? 0} statusKey={activeTab?.statusKey ?? 0} />
              </div>
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
          target={pullTarget}
          onClose={() => setPullDrawerOpen(false)}
          onSuccess={() => { preArmThrottle(activeTabId, "refs"); bumpListKey(activeTabId); }}
        />
      )}

      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        theme={theme}
        setTheme={setTheme}
        accentHue={accentHue}
        setAccentHue={setAccentHue}
      />
    </div>
  );
}
