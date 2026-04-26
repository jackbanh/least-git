import GitOutputDrawer from "./GitOutputDrawer";

export interface PullTarget {
  remote: string;
  branch: string;
}

export default function PullDrawer({
  tabId,
  opened,
  target,
  onClose,
  onSuccess,
}: {
  tabId: string;
  opened: boolean;
  /** When undefined, pulls the current branch from its configured upstream. */
  target?: PullTarget;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const displayCommand = target
    ? `git pull --rebase --autostash ${target.remote} ${target.branch}`
    : "git pull --rebase --autostash";

  return (
    <GitOutputDrawer
      tabId={tabId}
      opened={opened}
      title={target ? `Pull ${target.remote}/${target.branch}` : "Pull"}
      command="pull_with_rebase"
      commandArgs={target ? { remote: target.remote, branch: target.branch } : { remote: null, branch: null }}
      eventPrefix="pull"
      displayCommand={displayCommand}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
