type Handler<T> = (payload: T) => void;

/** Minimal typed event emitter used to talk from the game to the UI (and between systems). */
export class Emitter<E extends object> {
  private handlers: { [K in keyof E]?: Set<Handler<E[K]>> } = {};

  on<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    (this.handlers[key] ??= new Set()).add(fn);
    return () => this.handlers[key]?.delete(fn);
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    this.handlers[key]?.forEach((fn) => fn(payload));
  }
}
