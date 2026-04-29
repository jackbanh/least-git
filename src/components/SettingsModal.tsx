import { useCallback, useEffect, useRef, useState } from "react";
import { Anchor, Modal, ScrollArea, Stack, Switch, TableOfContents, Text } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import "./SettingsModal.css";

const ACCENT_HUES = [
  { label: "Sage",  value: 155 },
  { label: "Clay",  value: 35  },
  { label: "Honey", value: 75  },
  { label: "Lilac", value: 310 },
  { label: "Teal",  value: 200 },
];

// Selector scoped to this attribute so useScrollSpy never picks up headings
// from the rest of the app.  IDs must live on the <h2> itself — that is what
// useScrollSpy reads via `heading.id || randomId()`.
const HEADING_ATTR = "data-settings-h";
const HEADING_SEL  = `h2[${HEADING_ATTR}]`;

// ── Git config settings ───────────────────────────────────────────────────────

interface GitConfigSetting {
  key: string;
  label: string;
  description: string;
  docsUrl: string;
  /** Value written to git config when the switch is ON. */
  onValue: string;
  /** Derive switch state from the current stored value (null = unset). */
  isOn: (stored: string | null) => boolean;
}

const GIT_CONFIG_SETTINGS: GitConfigSetting[] = [
  {
    key: "core.fsmonitor",
    label: "Built-in FSMonitor",
    description:
      "Runs a background daemon that tracks filesystem changes so git status " +
      "only needs to check files the OS flagged as modified — instead of " +
      "scanning every file. The single biggest performance win for large repos " +
      "on Windows. Requires git ≥ 2.37.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-corefsmonitor",
    onValue: "true",
    isOn: (v) => v === "true",
  },
  {
    key: "core.untrackedCache",
    label: "Untracked file cache",
    description:
      "Caches the result of the untracked-file scan per directory, keyed by " +
      "mtime. Avoids re-scanning directories whose timestamps haven't changed. " +
      "Works synergistically with FSMonitor — together they make git status " +
      "nearly instant after the first run.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-coreuntrackedCache",
    onValue: "true",
    isOn: (v) => v === "true",
  },
  {
    key: "feature.manyFiles",
    label: "Many-files optimisations",
    description:
      "A compound flag that enables index version 4 (better path-name " +
      "compression for monorepos with deep shared prefixes) and turns on the " +
      "untracked cache. Recommended for repos with tens of thousands of files.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-featuremanyFiles",
    onValue: "true",
    isOn: (v) => v === "true",
  },
  {
    key: "core.commitGraph",
    label: "Commit graph",
    description:
      "Stores a precomputed graph of commit relationships on disk. Makes " +
      "git log, reachability checks, and merge-base lookups dramatically " +
      "faster on repos with deep history. Enabled by default in git ≥ 2.24 " +
      "but worth setting explicitly.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-corecommitGraph",
    onValue: "true",
    isOn: (v) => v === "true",
  },
  {
    key: "fetch.writeCommitGraph",
    label: "Auto-update commit graph on fetch",
    description:
      "Rewrites the commit graph file after every git fetch so it stays " +
      "current with new history. Pairs with the commit graph setting above. " +
      "The rewrite is incremental and typically adds only a few milliseconds.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-fetchwriteCommitGraph",
    onValue: "true",
    isOn: (v) => v === "true",
  },
  {
    key: "maintenance.auto",
    label: "Suppress automatic maintenance",
    description:
      "Prevents git from running background maintenance tasks (repacking, " +
      "loose-object pruning) mid-operation. On a large slow repo these tasks " +
      "can block for minutes at an unpredictable moment. Run " +
      "git maintenance run manually instead.",
    docsUrl: "https://git-scm.com/docs/git-config#Documentation/git-config.txt-maintenanceauto",
    onValue: "false",
    isOn: (v) => v === "false",
  },
];

const CONFIG_KEYS = GIT_CONFIG_SETTINGS.map((s) => s.key);

function GitConfigSection() {
  // null = still loading, undefined = unset, string = stored value
  const [values, setValues] = useState<Record<string, string | null> | null>(null);

  useEffect(() => {
    invoke<Record<string, string | null>>("get_git_config_globals", { keys: CONFIG_KEYS })
      .then(setValues)
      .catch(() => setValues({}));
  }, []);

  const toggle = useCallback(async (setting: GitConfigSetting, checked: boolean) => {
    const newValue = checked ? setting.onValue : null;
    // Optimistic update
    setValues((prev) => prev ? { ...prev, [setting.key]: newValue } : prev);
    try {
      await invoke("set_git_config_global", { key: setting.key, value: newValue });
    } catch {
      // Revert on failure
      setValues((prev) => prev ? { ...prev, [setting.key]: checked ? null : setting.onValue } : prev);
    }
  }, []);

  return (
    <Stack gap="xl">
      {GIT_CONFIG_SETTINGS.map((setting) => {
        const stored = values?.[setting.key] ?? null;
        const checked = setting.isOn(stored);
        return (
          <div key={setting.key} className="gc-row">
            <div className="gc-row-text">
              <Text className="gc-label">{setting.label}</Text>
              <Text className="gc-description">{setting.description}</Text>
              <Anchor
                href={setting.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="gc-docs-link"
              >
                git-scm.com docs ↗
              </Anchor>
            </div>
            <Switch
              checked={checked}
              disabled={values === null}
              onChange={(e) => toggle(setting, e.currentTarget.checked)}
              size="sm"
            />
          </div>
        );
      })}
    </Stack>
  );
}

export default function SettingsModal({
  opened,
  onClose,
  theme,
  setTheme,
  accentHue,
  setAccentHue,
}: {
  opened: boolean;
  onClose: () => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  accentHue: number;
  setAccentHue: (h: number) => void;
}) {
  const [activeId, setActiveId] = useState("s-appearance");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track which heading is scrolled into view so the TOC active state updates
  // as the user scrolls, not only on click.
  useEffect(() => {
    if (!opened) return;
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    // Observe the <h2> headings directly — they carry the id the spy uses.
    document.querySelectorAll<HTMLElement>(HEADING_SEL).forEach((el) => {
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, [opened]);

  function scrollTo(id: string) {
    setActiveId(id);
    // id is on the <h2>, not the <section>
    const heading = document.getElementById(id);
    const viewport = scrollRef.current;
    if (!heading || !viewport) return;
    const top =
      heading.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      viewport.scrollTop -
      16;
    viewport.scrollTo({ top, behavior: "smooth" });
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Settings"
      size={680}
      centered
      styles={{ body: { padding: 0 } }}
    >
      <div className="settings-layout">
        {/* ── Left: table of contents ───────────────────────────────── */}
        <nav className="settings-nav">
          <TableOfContents
            scrollSpyOptions={{ selector: HEADING_SEL }}
            variant="subtle"
            color="gray"
            getControlProps={({ data }) => ({
              children: data.value,
              "data-active": (activeId === data.id) || undefined,
              onClick: () => scrollTo(data.id),
            })}
          />
        </nav>

        <div className="settings-divider" />

        {/* ── Right: scrollable sections ────────────────────────────── */}
        <ScrollArea
          className="settings-scroll"
          h={440}
          viewportRef={scrollRef}
          offsetScrollbars
        >
          <div className="settings-body">

            {/* ── Appearance ────────────────────────────────────────── */}
            <section className="settings-section">
              <h2 id="s-appearance" className="settings-section-heading" data-settings-h>Appearance</h2>

              <div className="settings-row">
                <span className="settings-label">Theme</span>
                <div className="settings-seg">
                  <button
                    className={`settings-seg-btn${theme === "light" ? " settings-seg-btn--on" : ""}`}
                    onClick={() => setTheme("light")}
                  >Light</button>
                  <button
                    className={`settings-seg-btn${theme === "dark" ? " settings-seg-btn--on" : ""}`}
                    onClick={() => setTheme("dark")}
                  >Dark</button>
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-label">Accent</span>
                <div>
                  <div className="settings-swatches">
                    {ACCENT_HUES.map((h) => (
                      <button
                        key={h.value}
                        title={h.label}
                        className={`settings-swatch${accentHue === h.value ? " settings-swatch--on" : ""}`}
                        onClick={() => setAccentHue(h.value)}
                      >
                        <div
                          className="settings-swatch-dot"
                          style={{
                            background: `oklch(${theme === "dark" ? "72%" : "55%"} 0.08 ${h.value})`,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  <div className="settings-hue-label">hue: {accentHue}°</div>
                </div>
              </div>
            </section>

            {/* ── Git Config ────────────────────────────────────────── */}
            <section className="settings-section">
              <h2 id="s-git-config" className="settings-section-heading" data-settings-h>Git Config</h2>
              <GitConfigSection />
            </section>

            {/* ── About ─────────────────────────────────────────────── */}
            <section className="settings-section">
              <h2 id="s-about" className="settings-section-heading" data-settings-h>About</h2>
              <div className="settings-about">
                <span className="settings-about-app">least-git</span>
                <span className="settings-about-version">Version 0.3.0</span>
                <span className="settings-about-author">Jack Banh</span>
              </div>
            </section>

          </div>
        </ScrollArea>
      </div>
    </Modal>
  );
}
