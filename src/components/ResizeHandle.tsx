import React, {useRef} from "react";

type ResizeHandleProps = {
  /** Reports the pointer position while dragging so the owner can size itself. */
  onDrag(clientX: number): void
  /** Called once the drag finishes, so the owner can persist the result. */
  onCommit(): void
};

/**
 * A vertical splitter that resizes the panel it belongs to. The panel sits on
 * the right, so dragging the handle left widens it.
 *
 * Deliberately mouse-only: every part of the panel is readable at its minimum
 * width, so resizing is a preference rather than something a keyboard user
 * needs, and giving a drag affordance a focus stop would only add a control
 * that never has to be operated.
 */
export function ResizeHandle({onDrag, onCommit}: ResizeHandleProps) {
  const dragging = useRef(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) {
      onDrag(event.clientX);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) {
      return;
    }
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit();
  };

  return <div
    className="maputnik-resize-handle"
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerEnd}
    onPointerCancel={handlePointerEnd}
  />;
}
