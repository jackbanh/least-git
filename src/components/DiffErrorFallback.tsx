import { Button } from "@mantine/core";

// Fallback for the diff/preview ErrorBoundary. Keeps the rest of the app usable
// when a single file fails to render; recovers automatically on selecting another.
export default function DiffErrorFallback({ reset }: { reset: () => void }) {
  return (
    <div className="diff-loading" style={{ flexDirection: "column", gap: 10 }}>
      <span className="diff-loading-text">Couldn&rsquo;t display this file.</span>
      <Button size="xs" variant="default" onClick={reset}>Try again</Button>
    </div>
  );
}
