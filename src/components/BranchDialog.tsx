import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Modal, Tabs, TextInput, Button, Group, Text, Checkbox, Stack, ScrollArea, Loader,
} from "@mantine/core";

interface BranchInfo {
  name: string;
  is_head: boolean;
}

export default function BranchDialog({
  tabId,
  opened,
  onClose,
  onChanged,
}: {
  tabId: string;
  opened: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newBranchName, setNewBranchName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Delete-branch state
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Load branches whenever the dialog opens so the delete list is current.
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setLoadingBranches(true);
    invoke<BranchInfo[]>("list_branches", { tabId })
      .then((b) => { if (!cancelled) setBranches(b); })
      .catch(() => { if (!cancelled) setBranches([]); })
      .finally(() => { if (!cancelled) setLoadingBranches(false); });
    return () => { cancelled = true; };
  }, [opened, tabId]);

  // Show every local branch, sorted alphabetically. The current branch is
  // listed but its checkbox is disabled — git can't delete a checked-out branch.
  const sortedBranches = useMemo(
    () => [...branches].sort((a, b) => a.name.localeCompare(b.name)),
    [branches],
  );

  function handleClose() {
    setNewBranchName("");
    setError(null);
    setSelected(new Set());
    setDeleteError(null);
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
      onChanged();
      handleClose();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setCreating(false);
    }
  }

  function toggle(name: string) {
    setDeleteError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleDelete() {
    const names = sortedBranches
      .filter((b) => !b.is_head && selected.has(b.name))
      .map((b) => b.name);
    if (names.length === 0) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await invoke("delete_branches", { tabId, names });
      onChanged();
      handleClose();
    } catch (e) {
      setDeleteError(typeof e === "string" ? e : String(e));
    } finally {
      setDeleting(false);
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
          {loadingBranches ? (
            <Group justify="center" py="lg">
              <Loader size="sm" />
            </Group>
          ) : sortedBranches.length === 0 ? (
            <Text c="dimmed" size="sm">No local branches to delete.</Text>
          ) : (
            <>
              <Text c="dimmed" size="xs" mb="xs">
                Force-deletes the selected local branches. Remote branches are not affected.
              </Text>
              <ScrollArea.Autosize mah={240} type="auto">
                <Stack gap="xs" pr="sm">
                  {sortedBranches.map((b) => (
                    <Checkbox
                      key={b.name}
                      label={b.is_head ? `${b.name} (current)` : b.name}
                      checked={selected.has(b.name)}
                      onChange={() => toggle(b.name)}
                      disabled={deleting || b.is_head}
                    />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </>
          )}

          {deleteError && (
            <Text c="red" size="sm" mt="sm">{deleteError}</Text>
          )}

          <Group justify="flex-end" mt="md" gap="xs">
            <Button variant="default" onClick={handleClose} disabled={deleting}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleDelete}
              disabled={selected.size === 0}
              loading={deleting}
            >
              {selected.size > 0 ? `Delete ${selected.size} branch${selected.size === 1 ? "" : "es"}` : "Delete"}
            </Button>
          </Group>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
