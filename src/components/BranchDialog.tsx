import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, Tabs, TextInput, Button, Group, Text } from "@mantine/core";

export default function BranchDialog({
  tabId,
  opened,
  onClose,
  onCreated,
}: {
  tabId: string;
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [newBranchName, setNewBranchName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function handleClose() {
    setNewBranchName("");
    setError(null);
    onClose();
  }

  async function handleCreate() {
    const name = newBranchName.trim();
    if (!name) return;
    setError(null);
    setCreating(true);
    try {
      await invoke("create_branch", { tabId, name });
      setNewBranchName("");
      onCreated();
      onClose();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Branch"
      centered
      size="sm"
    >
      <Tabs defaultValue="new">
        <Tabs.List>
          <Tabs.Tab value="new">New Branch</Tabs.Tab>
          <Tabs.Tab value="delete">Delete Branch</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="new" pt="md">
          <TextInput
            label="Branch name"
            placeholder="feature/my-branch"
            value={newBranchName}
            onChange={(e) => {
              setNewBranchName(e.currentTarget.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            error={error}
            data-autofocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <Group justify="flex-end" mt="md" gap="xs">
            <Button variant="default" onClick={handleClose} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newBranchName.trim()}
              loading={creating}
            >
              Create
            </Button>
          </Group>
        </Tabs.Panel>

        <Tabs.Panel value="delete" pt="md">
          <Text c="dimmed" size="sm">TBD</Text>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
