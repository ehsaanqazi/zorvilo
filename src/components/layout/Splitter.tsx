import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Draggable divider between two panels. Calls onResize with the new size
 * (px for horizontal splits, ratio 0..1 for the vertical response split).
 */
export function Splitter({
  orientation,
  onDrag,
  className,
}: {
  orientation: 'vertical' | 'horizontal';
  /** delta in px since last event */
  onDrag: (deltaPx: number) => void;
  className?: string;
}) {
  const dragging = React.useRef(false);
  const last = React.useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    last.current = orientation === 'vertical' ? e.clientX : e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const pos = orientation === 'vertical' ? e.clientX : e.clientY;
    const delta = pos - last.current;
    if (delta !== 0) {
      last.current = pos;
      onDrag(delta);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  return (
    <div
      role="separator"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        'group relative z-10 shrink-0',
        orientation === 'vertical' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
        'bg-border',
        className,
      )}
    >
      <div
        className={cn(
          'absolute transition-colors group-hover:bg-primary/40 group-active:bg-primary/60',
          orientation === 'vertical' ? '-left-1 -right-1 bottom-0 top-0' : '-bottom-1 -top-1 left-0 right-0',
        )}
      />
    </div>
  );
}
