import {
  IconRefresh,
  IconArrowBarDown,
  IconGitBranch,
  IconAdjustments,
  IconChevronDown,
  IconArrowsExchange,
} from "@tabler/icons-react";
import { ActionIcon, Indicator, Menu } from "@mantine/core";
import type { PullTarget } from "./PullDrawer";
export type { PullTarget };
export interface PullRequest { target?: PullTarget; rebase: boolean; }
import "./Toolbar.css";

const ICON_SIZE = 14;

function ToolbarBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button className="toolbar-btn" onClick={onClick}>
      <span className="toolbar-btn-icon">{icon}</span>
      {label}
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
    <Menu position="bottom-start" width={210} shadow="md" radius="md">
      <Menu.Target>
        <button className="toolbar-btn pull-menu-btn">
          <span className="toolbar-btn-icon"><IconArrowBarDown size={ICON_SIZE} /></span>
          Pull
          <IconChevronDown size={10} className="pull-menu-chevron" />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        {options.map((opt) => (
          <Menu.Item key={opt.label} disabled={opt.disabled} onClick={() => onPull?.(opt.req)}>
            <span className="pull-menu-item-label">{opt.label}</span>
            <span className="pull-menu-item-sublabel">{opt.sublabel}</span>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

function RebaseMenuBtn({ disabled, onContinue, onAbort }: { disabled?: boolean; onContinue?: () => void; onAbort?: () => void }) {
  return (
    <Menu position="bottom-start" width={220} shadow="md" radius="md">
      <Menu.Target>
        <button className="toolbar-btn pull-menu-btn" disabled={disabled}>
          <span className="toolbar-btn-icon"><IconArrowsExchange size={ICON_SIZE} /></span>
          Rebase
          <IconChevronDown size={10} className="pull-menu-chevron" />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={onContinue}>
          <span className="pull-menu-item-label">Continue Rebase</span>
          <span className="pull-menu-item-sublabel">git rebase --continue</span>
        </Menu.Item>
        <Menu.Item color="red" onClick={onAbort}>
          <span className="pull-menu-item-label">Abort Rebase</span>
          <span className="pull-menu-item-sublabel">git rebase --abort</span>
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export default function Toolbar({
  currentBranch,
  pullBranchInfo,
  isRebasing,
  onPull,
  onBranch,
  onRefresh,
  onRebaseContinue,
  onRebaseAbort,
  onToggleTweaks,
  settingsBadge,
}: {
  currentBranch?: string;
  pullBranchInfo?: PullBranchInfo;
  isRebasing?: boolean;
  onPull?: (req: PullRequest) => void;
  onBranch?: () => void;
  onRefresh?: () => void;
  onRebaseContinue?: () => void;
  onRebaseAbort?: () => void;
  onToggleTweaks?: () => void;
  settingsBadge?: number;
}) {
  const needsAttention = settingsBadge != null && settingsBadge > 0;
  return (
    <div className="toolbar">
      <ToolbarBtn icon={<IconRefresh size={ICON_SIZE} />} label="Refresh" onClick={onRefresh} />
      <PullMenuBtn onPull={onPull} pullBranchInfo={pullBranchInfo} />
      <ToolbarBtn icon={<IconGitBranch size={ICON_SIZE} />} label="Branch" onClick={onBranch} />
      <RebaseMenuBtn disabled={!isRebasing} onContinue={onRebaseContinue} onAbort={onRebaseAbort} />
      <div className="toolbar-spacer" />
      {currentBranch && (
        <div className="toolbar-branch-pill">
          <IconGitBranch size={11} />
          <span className="toolbar-branch-name">{currentBranch}</span>
        </div>
      )}
      <Indicator
        color="var(--lg-diff-rem-bar)"
        size={9}
        offset={5}
        withBorder
        disabled={!needsAttention}
        aria-label={needsAttention ? `${settingsBadge} settings need attention` : undefined}
      >
        <ActionIcon
          className="toolbar-icon-btn"
          variant="subtle"
          color="gray"
          onClick={onToggleTweaks}
          title="Settings"
          aria-label="Settings"
        >
          <IconAdjustments size={ICON_SIZE} />
        </ActionIcon>
      </Indicator>
    </div>
  );
}
