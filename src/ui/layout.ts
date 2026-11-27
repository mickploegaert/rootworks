import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Panels the player can move (and some resize). A panel starts where the stylesheet puts it; once dragged or resized it
 * keeps its own rectangle, remembered in the browser. Reset puts every panel back.
 */
export interface Rect { x: number; y: number; w?: number; h?: number }
const KEY = 'rootworks.layout.v1';
const RESET = 'rootworks:layout-reset';

function readAll(): Record<string, Rect> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Rect>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}
function writeOne(id: string, r: Rect | null): void {
  const all = readAll();
  if (r) all[id] = r; else delete all[id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* memory only */ }
}

/** Put every panel back where the game places it. */
export function resetLayout(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
  window.dispatchEvent(new Event(RESET));
}

const ok = (r: unknown): r is Rect => !!r && typeof r === 'object' && Number.isFinite((r as Rect).x) && Number.isFinite((r as Rect).y);
const INTERACTIVE = 'button, input, select, textarea, a, label, [contenteditable="true"], .cm-editor';

export function useMovable(id: string, opts: { minW?: number; minH?: number } = {}) {
  const ref = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(() => { const r = readAll()[id]; return ok(r) ? r : null; });
  useEffect(() => {
    const reset = () => setRect(null);
    window.addEventListener(RESET, reset);
    return () => window.removeEventListener(RESET, reset);
  }, []);

  /** Drag (move) or resize from a pointer-down; deltas are divided by the UI scale so the panel follows the cursor. */
  const begin = useCallback((e: ReactPointerEvent, mode: 'move' | 'size') => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    if (mode === 'move' && (e.target as HTMLElement).closest(INTERACTIVE)) return;
    e.preventDefault();
    const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
    const parent = (el.offsetParent as HTMLElement | null) ?? document.body;
    const start = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, px: e.clientX, py: e.clientY };
    const maxW = parent.clientWidth, maxH = parent.clientHeight;
    let last: Rect = { ...start };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / z, dy = (ev.clientY - start.py) / z;
      if (mode === 'move') {
        last = { x: Math.round(Math.max(0, Math.min(maxW - 60, start.x + dx))), y: Math.round(Math.max(0, Math.min(maxH - 40, start.y + dy))), w: rect?.w, h: rect?.h };
        if (!rect?.w) { last.w = undefined; last.h = undefined; }
      } else {
        last = { x: start.x, y: start.y, w: Math.round(Math.max(opts.minW ?? 200, Math.min(maxW - start.x, start.w + dx))), h: Math.round(Math.max(opts.minH ?? 120, Math.min(maxH - start.y, start.h + dy))) };
      }
      setRect(last);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); writeOne(id, last); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [id, rect, opts.minW, opts.minH]);

  const reset = useCallback(() => { writeOne(id, null); setRect(null); }, [id]);
  // a moved panel keeps its spot but never leaves the screen when the window shrinks
  const style: CSSProperties | undefined = rect ? {
    left: `min(${rect.x}px, calc(100% - 80px))`, top: `min(${rect.y}px, calc(100% - 48px))`, right: 'auto', bottom: 'auto', transform: 'none',
    ...(rect.w ? { width: rect.w, maxWidth: 'calc(100% - 16px)' } : {}), ...(rect.h ? { height: rect.h, maxHeight: 'calc(100% - 16px)' } : {}),
  } : undefined;
  return {
    ref, style, moved: !!rect, reset,
    /** Spread on the element that drags the panel (a header, or a grip). Double-click puts the panel back. */
    dragProps: { onPointerDown: (e: ReactPointerEvent) => begin(e, 'move'), onDoubleClick: reset },
    sizeProps: { onPointerDown: (e: ReactPointerEvent) => begin(e, 'size') },
  };
}
