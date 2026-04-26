import GitOutputDrawer from "./GitOutputDrawer";

export interface PullTarget {
  remote: string;
  branch: string;
}

export default function PullDrawer({
  tabId,
  opened,
  target,
  rebase = false,
  onClose,
  onSuccess,
}: {
  tabId: string;
  opened: boolean;
  /** When undefined, pulls the current branch from its configured upstream. */
  target?: PullTarget;
  /** Whether to pass --rebase --autostash. Defaults to false for current-branch pulls. */
  rebase?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const rebaseFlags = rebase ? " --rebase --autostash" : "";
  const displayCommand = target
    ? `git pull${rebaseFlags} ${target.remote} ${target.branch}`
    : `git pull${rebaseFlags}`;

  return (
    <GitOutputDrawer
      tabId={tabId}
      opened={opened}
      title={target ? `Pull ${target.remote}/${target.branch}` : "Pull"}
      command="pull_with_rebase"
      commandArgs={{ rebase, remote: target?.remote ?? null, branch: target?.branch ?? null }}
      eventPrefix="pull"
      displayCommand={displayCommand}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
