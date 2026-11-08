import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Minimal fixed-row-height virtualizer. Renders only visible rows (+overscan),
 * which keeps trees/history smooth with thousands of entries.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  className,
  overscan = 10,
}: {
  items: T[];
  rowHeight: number;
  renderRow: (item: T, index: number) => React.ReactNode;
  className?: string;
  overscan?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportH(el.clientHeight));
    observer.observe(el);
    setViewportH(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const total = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + viewportH) / rowHeight) + overscan);
  const visible = items.slice(start, end);

  return (
    <div
      ref={ref}
      className={cn('overflow-y-auto', className)}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: total, position: 'relative' }}>
        <div style={{ transform: `translateY(${start * rowHeight}px)` }}>
          {visible.map((item, i) => renderRow(item, start + i))}
        </div>
      </div>
    </div>
  );
}
