import type { Camera } from '../camera/Camera.ts';

export interface InputHandlers {
  /** Screen position of the pointer, or null when it left the canvas. */
  onHover(pos: { x: number; y: number } | null): void;
  onClick(x: number, y: number): void;
  onEscape(): void;
  onRotate(): void;
}

const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
};

/** Translates DOM mouse/keyboard events into camera moves and tile clicks. */
export class InputController {
  private dragging = false;
  private moved = 0;
  private lastX = 0;
  private lastY = 0;
  private readonly keys = new Set<string>();
  private readonly cleanup: (() => void)[] = [];

  constructor(el: HTMLElement, private readonly camera: Camera, handlers: InputHandlers) {
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.style.cursor = 'grab';

    this.listen(el, 'pointerdown', (e: PointerEvent) => {
      if (e.button > 2) return;
      this.dragging = true; this.moved = 0; this.lastX = e.clientX; this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });
    this.listen(el, 'pointermove', (e: PointerEvent) => {
      if (this.dragging) {
        const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
        this.moved += Math.abs(dx) + Math.abs(dy);
        this.lastX = e.clientX; this.lastY = e.clientY;
        if (this.moved > 4) camera.dragBy(dx, dy);
      }
      handlers.onHover(local(e));
    });
    this.listen(el, 'pointerup', (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false; el.style.cursor = 'grab';
      if (this.moved <= 4 && e.button === 0) { const p = local(e); handlers.onClick(p.x, p.y); }
    });
    this.listen(el, 'pointerleave', () => handlers.onHover(null));
    this.listen(el, 'contextmenu', (e: Event) => e.preventDefault());
    this.listen(el, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      camera.zoomStep(e.deltaY < 0 ? 1 : -1, p.x, p.y);
    }, { passive: false });
    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      // keys typed into the code editor or a form field belong to that field, not the camera
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') handlers.onEscape();
      if (k === 'r') handlers.onRotate();
      if (k in PAN_KEYS) { this.keys.add(k); e.preventDefault(); }
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    this.listen(window, 'blur', () => this.keys.clear());
  }

  /** Apply held keys; call once per frame. */
  update(dt: number): void {
    let dx = 0, dy = 0;
    for (const k of this.keys) { dx += PAN_KEYS[k][0]; dy += PAN_KEYS[k][1]; }
    if (dx || dy) this.camera.nudge((dx * 520 * dt) / this.camera.zoom, (dy * 520 * dt) / this.camera.zoom);
  }

  destroy(): void { this.cleanup.forEach((f) => f()); }

  private listen<E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions): void {
    t.addEventListener(type, fn as EventListener, opts);
    this.cleanup.push(() => t.removeEventListener(type, fn as EventListener, opts));
  }
}
