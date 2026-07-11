import { Button, Code, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

// Full-window fallback for the app-level ErrorBoundary — shown only if something
// unrecoverable escapes every inner boundary.
export default function AppCrash({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Stack align="center" gap="sm" maw={440}>
        <IconAlertTriangle size={40} color="var(--lg-diff-rem-bar)" />
        <Title order={4}>Something went wrong</Title>
        <Text c="dimmed" size="sm" ta="center">
          least-git hit an unexpected error. Your repository is untouched — try again, and
          if it keeps happening, reopen the app.
        </Text>
        {error.message && (
          <Code block style={{ maxWidth: "100%", whiteSpace: "pre-wrap" }}>{error.message}</Code>
        )}
        <Button onClick={reset} mt="xs">Try again</Button>
      </Stack>
    </div>
  );
}
