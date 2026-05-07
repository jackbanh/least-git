import { useEffect, useRef, useState } from "react";
import {
  IconRefresh,
  IconArrowBarDown,
  IconArrowBarUp,
  IconGitBranch,
  IconAdjustments,
  IconChevronDown,
  IconArrowsExchange,
} from "@tabler/icons-react";
import type { PullTarget } from "./PullDrawer";
export type { PullTarget };
export interface PullRequest { target?: PullTarget; rebase: boolean; }
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

interface PullBranchInfo {
  hasMain: boolean;
  hasMaster: boolean;
  headBranch: string | null;
}

function PullMenuBtn({ onPull, pullBranchInfo }: {
  onPull?: (req: PullRequest) => void;
  pullBranchInfo?: PullBranchInfo;
}) {
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

  const { hasMain, hasMaster, headBranch } = pullBranchInfo ?? {
    hasMain: false, hasMaster: false, headBranch: null,
  };

  type PullOption = { label: string; sublabel: string; req: PullRequest; disabled?: boolean };
  const options: PullOption[] = [
    {
      label: "Pull current branch",
      sublabel: "git pull",
      req: { rebase: false },
    },
    ...(hasMain ? [{
      label: "Pull origin/main",
      sublabel: "--rebase --autostash",
      req: { target: { remote: "origin", branch: "main" }, rebase: true },
      disabled: headBranch === "main",
    }] : []),
    ...(hasMaster ? [{
      label: "Pull origin/master",
      sublabel: "--rebase --autostash",
      req: { target: { remote: "origin", branch: "master" }, rebase: true },
      disabled: headBranch === "master",
    }] : []),
  ];

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
          {options.map((opt) => (
            <button
              key={opt.label}
              className={`pull-menu-item${opt.disabled ? " pull-menu-item--disabled" : ""}`}
              disabled={opt.disabled}
              onClick={() => {
                setOpen(false);
                onPull?.(opt.req);
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

function RebaseMenuBtn({ disabled, onContinue, onAbort }: { disabled?: boolean; onContinue?: () => void; onAbort?: () => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="pull-menu-wrap">
      <button
        className={`toolbar-btn pull-menu-btn${hover || open ? " toolbar-btn--hover" : ""}${disabled ? " toolbar-btn--disabled" : ""}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className="toolbar-btn-icon"><IconArrowsExchange size={ICON_SIZE} /></span>
        Rebase
        <IconChevronDown size={10} className={`pull-menu-chevron${open ? " pull-menu-chevron--open" : ""}`} />
      </button>
      {open && (
        <div className="pull-menu-dropdown">
          <button className="pull-menu-item" onClick={() => { setOpen(false); onContinue?.(); }}>
            <span className="pull-menu-item-label">Continue Rebase</span>
            <span className="pull-menu-item-sublabel">git rebase --continue</span>
          </button>
          <button className="pull-menu-item pull-menu-item--abort" onClick={() => { setOpen(false); onAbort?.(); }}>
            <span className="pull-menu-item-label">Abort Rebase</span>
            <span className="pull-menu-item-sublabel">git rebase --abort</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function Toolbar({
  currentBranch,
  pullBranchInfo,
  isRebasing,
  onPull,
  onPush,
  onBranch,
  onRefresh,
  onRebaseContinue,
  onRebaseAbort,
  onToggleTweaks,
}: {
  currentBranch?: string;
  pullBranchInfo?: PullBranchInfo;
  isRebasing?: boolean;
  onPull?: (req: PullRequest) => void;
  onPush?: () => void;
  onBranch?: () => void;
  onRefresh?: () => void;
  onRebaseContinue?: () => void;
  onRebaseAbort?: () => void;
  onToggleTweaks?: () => void;
}) {
  return (
    <div className="toolbar">
      <ToolbarBtn icon={<IconRefresh size={ICON_SIZE} />} label="Refresh" onClick={onRefresh} />
      <PullMenuBtn onPull={onPull} pullBranchInfo={pullBranchInfo} />
      <ToolbarBtn icon={<IconArrowBarUp size={ICON_SIZE} />} label="Push" onClick={onPush} />
      <ToolbarBtn icon={<IconGitBranch size={ICON_SIZE} />} label="Branch" onClick={onBranch} />
      <RebaseMenuBtn disabled={!isRebasing} onContinue={onRebaseContinue} onAbort={onRebaseAbort} />
      <div className="toolbar-spacer" />
      {currentBranch && (
        <div className="toolbar-branch-pill">
          <IconGitBranch size={11} />
          <span className="toolbar-branch-name">{currentBranch}</span>
        </div>
      )}
      <ToolbarIconBtn icon={<IconAdjustments size={ICON_SIZE} />} onClick={onToggleTweaks} title="Settings" />
    </div>
  );
}
