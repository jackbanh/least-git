import { useCallback } from "react";

type Direction = "horizontal" | "vertical";

/**
 * Returns a mousedown handler that drives a resize via a setter.
 * direction: "horizontal" adjusts width, "vertical" adjusts height.
 * min/max: clamp bounds in pixels.
 * invert: set true when dragging toward the top/left reduces the value.
 */
export function useResize(
  current: number,
  setter: (v: number) => void,
  direction: Direction,
  min: number,
  max: number,
  invert = false
) {
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const start = direction === "horizontal" ? e.clientX : e.clientY;
      const startValue = current;

      function onMove(e: MouseEvent) {
        const delta =
          (direction === "horizontal" ? e.clientX : e.clientY) - start;
        const next = startValue + (invert ? -delta : delta);
        setter(Math.max(min, Math.min(max, next)));
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current]
  );
}
