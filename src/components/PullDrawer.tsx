import GitOutputDrawer from "./GitOutputDrawer";

export default function PullDrawer({
  tabId,
  opened,
  onClose,
  onSuccess,
}: {
  tabId: string;
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  return (
    <GitOutputDrawer
      tabId={tabId}
      opened={opened}
      title="Pull with Rebase"
      command="pull_with_rebase"
      commandArgs={{}}
      eventPrefix="pull"
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
