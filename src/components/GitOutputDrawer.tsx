import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Drawer, ScrollArea } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import "./PullDrawer.css";

type Status = "running" | "success" | "error";

/**
 * Generic drawer that streams git output via Tauri events.
 *
 * Rust must emit:
 *   `${eventPrefix}:line`  { tab_id, line }
 *   `${eventPrefix}:done`  { tab_id, success }
 */
export default function GitOutputDrawer({
  tabId,
  opened,
  title,
  command,
  commandArgs,
  eventPrefix,
  onClose,
  onSuccess,
}: {
  tabId: string;
  opened: boolean;
  title: string;
  command: string;
  commandArgs: Record<string, unknown>;
  eventPrefix: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("running");
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!opened) return;
    setLines([]);
    setStatus("running");

    const unlistenLine = listen<{ tab_id: string; line: string }>(`${eventPrefix}:line`, (e) => {
      if (e.payload.tab_id !== tabId) return;
      setLines((prev) => [...prev, e.payload.line]);
    });

    const unlistenDone = listen<{ tab_id: string; success: boolean }>(`${eventPrefix}:done`, (e) => {
      if (e.payload.tab_id !== tabId) return;
      setStatus(e.payload.success ? "success" : "error");
      if (e.payload.success) onSuccess();
    });

    invoke(command, { tabId, ...commandArgs }).catch((e: unknown) => {
      setLines((prev) => [...prev, String(e)]);
      setStatus("error");
    });

    return () => {
      unlistenLine.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const statusIcon =
    status === "success" ? <IconCheck size={16} color="var(--mantine-color-green-6)" /> :
    status === "error"   ? <IconX     size={16} color="var(--mantine-color-red-6)" />   :
    null;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="md"
      title={
        <span className="pull-drawer-title">
          {title}
          {statusIcon && <span className="pull-drawer-status-icon">{statusIcon}</span>}
        </span>
      }
      closeButtonProps={{ disabled: status === "running" }}
      withCloseButton
    >
      <ScrollArea
        viewportRef={viewportRef}
        className="pull-drawer-scroll"
        scrollbarSize={8}
        scrollHideDelay={0}
      >
        <pre className="pull-drawer-output">
          {lines.length > 0 ? lines.join("\n") : "Starting…"}
        </pre>
        <div ref={bottomRef} />
      </ScrollArea>
      <div className="pull-drawer-footer">
        <Button
          size="xs"
          variant="default"
          disabled={status === "running"}
          onClick={onClose}
        >
          Close
        </Button>
      </div>
    </Drawer>
  );
}
