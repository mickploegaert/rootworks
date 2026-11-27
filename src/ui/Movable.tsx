import type { useMovable } from './layout.ts';

type Movable = ReturnType<typeof useMovable>;

/** The little handle a panel is dragged by; double-click puts the panel back in its place. */
export function Grip({ m, label }: { m: Movable; label: string }) {
  return <span className="move-grip" role="button" tabIndex={-1} title={`Drag to move ${label}. Double-click to put it back.`} {...m.dragProps} aria-label={`Move ${label}`} />;
}

/** The corner handle that makes a panel bigger or smaller. */
export function SizeGrip({ m, label }: { m: Movable; label: string }) {
  return <span className="size-grip" title={`Drag to resize ${label}`} aria-hidden {...m.sizeProps} />;
}
