import { Fragment, useEffect, useRef, useState } from "react";
import { Anchor, ColorSwatch, Modal, ScrollArea, SegmentedControl, Stack, Switch, TableOfContents, Text } from "@mantine/core";
import { IconCircleCheck, IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { getVersion } from "@tauri-apps/api/app";
import { GIT_CONFIG_SETTINGS, countNotFollowing, isFollowing, switchOn } from "../gitConfig";
import { useGitConfigStore } from "../gitConfigStore";
import { isMac, shortcutLabel, plusShortcut, deleteShortcut } from "../lib/platform";
import "./SettingsModal.css";

// Reference list for the Keyboard Shortcuts section. Labels are platform-aware
// (⌘ on macOS, spelled-out Ctrl/Shift elsewhere) so they read clearly regardless
// of platform or first language.
const SHORTCUTS: { action: string; keys: string[] }[] = [
  { action: "Refresh", keys: isMac ? ["⌘R"] : ["Ctrl+R", "F5"] },
  { action: "Open branch dialog", keys: [shortcutLabel("B", { shift: true })] },
  { action: "Pull", keys: [shortcutLabel("P", { shift: true })] },
  { action: "Stage / add selected file", keys: [plusShortcut] },
  { action: "Discard changes to selected file", keys: [shortcutLabel("R", { shift: true })] },
  { action: "Delete selected untracked file", keys: [deleteShortcut] },
  { action: "Commit staged changes", keys: [shortcutLabel("Enter")] },
  { action: "Open selected file in external diff", keys: [shortcutLabel("D")] },
  { action: "Move up / down in lists", keys: ["↑", "↓"] },
];

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

// ── Git config section ─────────────────────────────────────────────────────────

function GitConfigSection() {
  const values = useGitConfigStore((s) => s.values);
  const setValue = useGitConfigStore((s) => s.setValue);
  const loading = values === null;

  return (
    <Stack gap="lg">
      {GIT_CONFIG_SETTINGS.map((setting) => {
        const on = switchOn(setting, values);
        const following = isFollowing(setting, values);
        const recommendLabel = setting.recommend === "on" ? "On" : "Off";
        // Colour the "on" track by which direction is recommended, reusing the
        // diff palette: green for settings we recommend enabling, red for ones
        // we recommend disabling.
        const switchColor = setting.recommend === "on" ? "var(--lg-diff-add-bar)" : "var(--lg-diff-rem-bar)";
        return (
          <div
            key={setting.key}
            className={`gc-row${loading ? "" : following ? " gc-row--ok" : " gc-row--warn"}`}
          >
            <div className="gc-row-text">
              <div className="gc-row-head">
                <Text className="gc-label">{setting.key}</Text>
                {setting.requires && <span className="gc-requires">{setting.requires}</span>}
              </div>
              <Text className="gc-description">{setting.description}</Text>
              <div className="gc-row-foot">
                {!loading && (
                  following ? (
                    <span className="gc-status gc-status--ok">
                      <IconCircleCheck size={15} /> Following recommendation
                    </span>
                  ) : (
                    <span className="gc-status gc-status--warn">
                      <IconAlertTriangle size={15} /> Recommended: {recommendLabel}
                    </span>
                  )
                )}
                <Anchor
                  href={setting.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gc-docs-link"
                >
                  docs ↗
                </Anchor>
              </div>
            </div>
            <Switch
              checked={on}
              disabled={loading}
              onChange={(e) => setValue(setting.key, e.currentTarget.checked ? setting.onValue : setting.offValue)}
              size="md"
              aria-label={`${setting.key} — recommended ${recommendLabel}`}
              style={{ "--switch-color": switchColor } as React.CSSProperties}
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
  const [version, setVersion] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const gitConfigValues = useGitConfigStore((s) => s.values);
  const loadGitConfig = useGitConfigStore((s) => s.load);
  const gcNotFollowing = countNotFollowing(gitConfigValues);

  // App version comes from tauri.conf.json via getVersion() — never hardcoded.
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  // Refresh git config each time the modal opens, in case it changed externally.
  useEffect(() => {
    if (opened) loadGitConfig();
  }, [opened, loadGitConfig]);

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
      size="min(880px, 94vw)"
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
              children:
                data.id === "s-git-config" && gcNotFollowing > 0 ? (
                  <span className="settings-nav-item">
                    {data.value}
                    <span className="settings-nav-badge">{gcNotFollowing}</span>
                  </span>
                ) : (
                  data.value
                ),
              "data-active": (activeId === data.id) || undefined,
              onClick: () => scrollTo(data.id),
            })}
          />
        </nav>

        <div className="settings-divider" />

        {/* ── Right: scrollable sections ────────────────────────────── */}
        <ScrollArea
          className="settings-scroll"
          h="calc(max(560px, 82vh) - 60px)"
          viewportRef={scrollRef}
          offsetScrollbars
        >
          <div className="settings-body">

            {/* ── Appearance ────────────────────────────────────────── */}
            <section className="settings-section">
              <h2 id="s-appearance" className="settings-section-heading" data-settings-h>Appearance</h2>

              <div className="settings-row">
                <span className="settings-label">Theme</span>
                <SegmentedControl
                  value={theme}
                  onChange={(v) => setTheme(v as "light" | "dark")}
                  size="xs"
                  data={[
                    { label: "Light", value: "light" },
                    { label: "Dark", value: "dark" },
                  ]}
                />
              </div>

              <div className="settings-row">
                <span className="settings-label">Accent</span>
                <div>
                  <div className="settings-swatches">
                    {ACCENT_HUES.map((h) => {
                      const color = `oklch(${theme === "dark" ? "72%" : "55%"} 0.08 ${h.value})`;
                      return (
                        <ColorSwatch
                          key={h.value}
                          component="button"
                          color={color}
                          size={26}
                          onClick={() => setAccentHue(h.value)}
                          title={h.label}
                          aria-label={h.label}
                          style={{ cursor: "pointer", color: "#fff" }}
                        >
                          {accentHue === h.value && <IconCheck size={15} />}
                        </ColorSwatch>
                      );
                    })}
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

            {/* ── Keyboard Shortcuts ────────────────────────────────── */}
            <section className="settings-section">
              <h2 id="s-shortcuts" className="settings-section-heading" data-settings-h>Keyboard Shortcuts</h2>
              <div className="settings-shortcuts">
                {SHORTCUTS.map((s) => (
                  <div className="settings-shortcut" key={s.action}>
                    <span className="settings-shortcut-action">{s.action}</span>
                    <span className="settings-shortcut-keys">
                      {s.keys.map((k, i) => (
                        <Fragment key={k}>
                          {i > 0 && <span className="settings-kbd-or">or</span>}
                          <kbd className="settings-kbd">{k}</kbd>
                        </Fragment>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* ── About ─────────────────────────────────────────────── */}
            <section className="settings-section">
              <h2 id="s-about" className="settings-section-heading" data-settings-h>About</h2>
              <div className="settings-about">
                <span className="settings-about-app">least-git</span>
                <span className="settings-about-version">
                  {version ? `Version ${version}` : "Version …"}
                </span>
                <span className="settings-about-author">Jack Banh</span>
              </div>
            </section>

          </div>
        </ScrollArea>
      </div>
    </Modal>
  );
}
