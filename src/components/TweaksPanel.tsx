import "./TweaksPanel.css";

const ACCENT_HUES = [
  { label: "Sage", value: 155 },
  { label: "Clay", value: 35 },
  { label: "Honey", value: 75 },
  { label: "Lilac", value: 310 },
  { label: "Teal", value: 200 },
];

export default function TweaksPanel({
  open,
  onClose,
  theme,
  setTheme,
  accentHue,
  setAccentHue,
}: {
  open: boolean;
  onClose: () => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  accentHue: number;
  setAccentHue: (h: number) => void;
}) {
  if (!open) return null;

  return (
    <div className="tweaks-panel">
      <div className="tweaks-header">
        <span className="tweaks-title">Tweaks</span>
        <button className="tweaks-close" onClick={onClose}>×</button>
      </div>

      <div className="tweaks-section">
        <div className="tweaks-label">Appearance</div>
        <div className="tweaks-seg">
          <button
            className={`tweaks-seg-btn${theme === "light" ? " tweaks-seg-btn--active" : ""}`}
            onClick={() => setTheme("light")}
          >Light</button>
          <button
            className={`tweaks-seg-btn${theme === "dark" ? " tweaks-seg-btn--active" : ""}`}
            onClick={() => setTheme("dark")}
          >Dark</button>
        </div>
      </div>

      <div className="tweaks-section">
        <div className="tweaks-label">Accent</div>
        <div className="tweaks-swatches">
          {ACCENT_HUES.map((h) => (
            <button
              key={h.value}
              title={h.label}
              className={`tweaks-swatch${accentHue === h.value ? " tweaks-swatch--active" : ""}`}
              onClick={() => setAccentHue(h.value)}
            >
              <div
                className="tweaks-swatch-dot"
                style={{ background: `oklch(${theme === "dark" ? "72%" : "55%"} 0.08 ${h.value})` }}
              />
            </button>
          ))}
        </div>
        <div className="tweaks-hue-label">hue: {accentHue}°</div>
      </div>
    </div>
  );
}
