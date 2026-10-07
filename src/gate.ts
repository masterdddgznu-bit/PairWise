/** Wind-gate pin store: pinned nozzles are blocked from glance/pull/blast. */
export class PinGate {
  readonly #pinned = new Set<string>();

  pin(id: string): void {
    this.#pinned.add(id);
  }

  unpin(id: string): void {
    this.#pinned.delete(id);
  }

  isPinned(id: string): boolean {
    return this.#pinned.has(id);
  }

  clear(id: string): void {
    this.#pinned.delete(id);
  }
}
