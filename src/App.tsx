import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Tabs, Button, ActionIcon, Group, Text } from "@mantine/core";
import { useTabStore, Tab } from "./store";
import BranchSwitcher from "./components/BranchSwitcher";
import CommitList from "./components/CommitList";
import CommitDetail from "./components/CommitDetail";
import "./App.css";

export default function App() {
  const { tabs, activeTabId, openTab, closeTab, setActiveTab } = useTabStore();
  const [sidebarWidth, setSidebarWidth] = useState(220);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

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

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMove(e: MouseEvent) {
      setSidebarWidth(Math.max(150, Math.min(500, startWidth + e.clientX - startX)));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="app-shell">
      <div className="tab-bar">
        <Tabs
          value={activeTabId}
          onChange={(v) => v && setActiveTab(v)}
          variant="outline"
        >
          <Group gap={0} wrap="nowrap" align="flex-end">
            <Tabs.List style={{ flexShrink: 0 }}>
              {tabs.map((tab) => (
                <Tabs.Tab key={tab.id} value={tab.id}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={activeTabId === tab.id ? 600 : 400}>
                      {tab.name}
                    </Text>
                    <ActionIcon
                      size={14}
                      variant="transparent"
                      c="dimmed"
                      onClick={(e) => {
                        e.stopPropagation();
                        invoke("close_tab", { tabId: tab.id });
                        closeTab(tab.id);
                      }}
                      aria-label={`Close ${tab.name}`}
                    >
                      ✕
                    </ActionIcon>
                  </Group>
                </Tabs.Tab>
              ))}
            </Tabs.List>
            <Button
              size="xs"
              variant="subtle"
              onClick={handleOpenFolder}
              style={{ marginLeft: 4, marginBottom: 2 }}
            >
              + Open Repo
            </Button>
          </Group>
        </Tabs>
      </div>

      <div className="workspace">
        {activeTabId ? (
          <>
            <div className="sidebar" style={{ width: sidebarWidth }}>
              <BranchSwitcher tabId={activeTabId} />
            </div>
            <div className="resize-handle" onMouseDown={startResize} />
            <div className="main-area">
              <div className="commit-list-pane">
                <CommitList
                  key={`${activeTabId}-${activeTab?.listKey ?? 0}`}
                  tabId={activeTabId}
                />
              </div>
              <div className="detail-pane">
                <CommitDetail tabId={activeTabId} />
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
    </div>
  );
}
