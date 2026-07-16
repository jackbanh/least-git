import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, Radio, Stack, Button, Group, Text, Code } from "@mantine/core";

export type ResetMode = "soft" | "hard";

export default function ResetDialog({
  tabId,
  opened,
  oid,
  summary,
  onClose,
  onReset,
}: {
  tabId: string;
  opened: boolean;
  oid: string | null;
  summary?: string;
  onClose: () => void;
  onReset: () => void;
}) {
  // Defaults to the non-destructive mode; --hard is always a deliberate choice.
  const [mode, setMode] = useState<ResetMode>("soft");
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  function handleClose() {
    setMode("soft");
    setError(null);
    onClose();
  }

  async function handleReset() {
    if (!oid) return;
    setError(null);
    setResetting(true);
    try {
      await invoke("reset_to_commit", { tabId, oid, mode });
      onReset();
      handleClose();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Reset to Here" centered size="md">
      <Text size="sm" c="dimmed">
        Move the current branch to <Code>{oid?.slice(0, 7)}</Code>
        {summary ? ` — ${summary}` : ""}
      </Text>

      {/* Both descriptions stay mounted so switching mode never resizes the
          dialog. Each option states its own consequence up front. */}
      <Radio.Group
        mt="md"
        value={mode}
        onChange={(v) => {
          setMode(v as ResetMode);
          setError(null);
        }}
      >
        <Stack gap="sm">
          <Radio
            value="soft"
            label="Soft"
            description="Keeps your working tree and index. Changes from the commits being undone are left staged, ready to re-commit."
          />
          <Radio
            value="hard"
            color="red"
            label="Hard"
            description="Resets the working tree and index. Every uncommitted change — staged and unstaged — is permanently destroyed. This cannot be undone."
          />
        </Stack>
      </Radio.Group>

      {error && (
        <Text size="sm" c="red" mt="sm">
          {error}
        </Text>
      )}

      <Group justify="flex-end" mt="md" gap="xs">
        <Button variant="default" onClick={handleClose} disabled={resetting}>
          Cancel
        </Button>
        <Button
          color={mode === "hard" ? "red" : undefined}
          onClick={handleReset}
          disabled={!oid}
          loading={resetting}
        >
          {mode === "hard" ? "Reset and discard changes" : "Reset"}
        </Button>
      </Group>
    </Modal>
  );
}
