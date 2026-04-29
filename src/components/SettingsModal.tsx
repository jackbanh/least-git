import { useEffect, useRef, useState } from "react";
import { Modal, ScrollArea, TableOfContents } from "@mantine/core";
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
              <p className="settings-placeholder">Content coming soon.</p>
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
