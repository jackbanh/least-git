import { useRef, useState } from "react";

export interface ContextMenuState<T> {
  x: number;
  y: number;
  data: T;
}

export function useContextMenu<T>() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState<T> | null>(null);
  const contextTargetRef = useRef<ContextMenuState<T> | null>(null);

  function open(e: React.MouseEvent, data: T) {
    e.preventDefault();
    const state = { x: e.clientX, y: e.clientY, data };
    contextTargetRef.current = state;
    setContextMenu(state);
  }

  function close() {
    setContextMenu(null);
  }

  return { contextMenu, contextTargetRef, open, close };
}
