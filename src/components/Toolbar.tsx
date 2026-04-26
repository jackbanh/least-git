import { useEffect, useRef, useState } from "react";
import {
  IconRefresh,
  IconArrowBarDown,
  IconArrowBarUp,
  IconGitBranch,
  IconAdjustments,
  IconChevronDown,
} from "@tabler/icons-react";
import type { PullTarget } from "./PullDrawer";
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

const PULL_OPTIONS: { label: string; sublabel: string; target?: PullTarget }[] = [
  {
    label: "Pull current branch",
    sublabel: "git pull --rebase --autostash",
    target: undefined,
  },
  {
    label: "Pull origin/main",
    sublabel: "--rebase --autostash",
    target: { remote: "origin", branch: "main" },
  },
  {
    label: "Pull origin/master",
    sublabel: "--rebase --autostash",
    target: { remote: "origin", branch: "master" },
  },
];

function PullMenuBtn({ onPull }: { onPull?: (target?: PullTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="pull-menu-wrap">
      <button
        className={`toolbar-btn pull-menu-btn${hover ? " toolbar-btn--hover" : ""}${open ? " toolbar-btn--hover" : ""}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="toolbar-btn-icon"><IconArrowBarDown size={ICON_SIZE} /></span>
        Pull
        <IconChevronDown size={10} className={`pull-menu-chevron${open ? " pull-menu-chevron--open" : ""}`} />
      </button>
      {open && (
        <div className="pull-menu-dropdown">
          {PULL_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              className="pull-menu-item"
              onClick={() => {
                setOpen(false);
                onPull?.(opt.target);
              }}
            >
              <span className="pull-menu-item-label">{opt.label}</span>
              <span className="pull-menu-item-sublabel">{opt.sublabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
  onPull?: (target?: PullTarget) => void;
  onPush?: () => void;
  onBranch?: () => void;
  onRefresh?: () => void;
  onToggleTweaks?: () => void;
}) {
  return (
    <div className="toolbar">
      <ToolbarBtn icon={<IconRefresh size={ICON_SIZE} />} label="Refresh" onClick={onRefresh} />
      <PullMenuBtn onPull={onPull} />
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
