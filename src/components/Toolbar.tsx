import { useState } from "react";
import "./Toolbar.css";

function PullIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 3v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4.5 7.5L8 11l3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 11V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4.5 6.5L8 3l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function BranchIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5v6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 8c4 0 6-1 6.5-1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M13 8A5 5 0 1 1 8 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M13 3v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3 5h7M13 5h0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3 11h3M9 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="11" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ToolbarBtn({ icon, label, badge, onClick }: { icon: React.ReactNode; label: string; badge?: string; onClick?: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      className={`toolbar-btn${hover ? " toolbar-btn--hover" : ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      <span className="toolbar-btn-icon">{icon}</span>
      {label}
      {badge && <span className="toolbar-btn-badge">{badge}</span>}
    </button>
  );
}

function ToolbarIconBtn({ icon, onClick, title }: { icon: React.ReactNode; onClick?: () => void; title?: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      className={`toolbar-icon-btn${hover ? " toolbar-icon-btn--hover" : ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}

export default function Toolbar({
  currentBranch,
  onPull,
  onPush,
  onBranch,
  onRefresh,
  onToggleTweaks,
}: {
  currentBranch?: string;
  onPull?: () => void;
  onPush?: () => void;
  onBranch?: () => void;
  onRefresh?: () => void;
  onToggleTweaks?: () => void;
}) {
  return (
    <div className="toolbar">
      <ToolbarBtn icon={<RefreshIcon />} label="Refresh" onClick={onRefresh} />
      <ToolbarBtn icon={<PullIcon />} label="Pull" onClick={onPull} />
      <ToolbarBtn icon={<PushIcon />} label="Push" onClick={onPush} />
      <ToolbarBtn icon={<BranchIcon />} label="Branch" onClick={onBranch} />
      <div className="toolbar-spacer" />
      {currentBranch && (
        <div className="toolbar-branch-pill">
          <BranchIcon size={11} />
          <span className="toolbar-branch-name">{currentBranch}</span>
        </div>
      )}
      <ToolbarIconBtn icon={<SlidersIcon />} onClick={onToggleTweaks} title="Tweaks" />
    </div>
  );
}
