import { useState } from "react";
import {
  IconRefresh,
  IconArrowBarDown,
  IconArrowBarUp,
  IconGitBranch,
  IconAdjustments,
} from "@tabler/icons-react";
import "./Toolbar.css";

const ICON_SIZE = 14;

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
      <ToolbarBtn icon={<IconRefresh size={ICON_SIZE} />} label="Refresh" onClick={onRefresh} />
      <ToolbarBtn icon={<IconArrowBarDown size={ICON_SIZE} />} label="Pull" onClick={onPull} />
      <ToolbarBtn icon={<IconArrowBarUp size={ICON_SIZE} />} label="Push" onClick={onPush} />
      <ToolbarBtn icon={<IconGitBranch size={ICON_SIZE} />} label="Branch" onClick={onBranch} />
      <div className="toolbar-spacer" />
      {currentBranch && (
        <div className="toolbar-branch-pill">
          <IconGitBranch size={11} />
          <span className="toolbar-branch-name">{currentBranch}</span>
        </div>
      )}
      <ToolbarIconBtn icon={<IconAdjustments size={ICON_SIZE} />} onClick={onToggleTweaks} title="Tweaks" />
    </div>
  );
}
