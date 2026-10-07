export class MaskGate {
  #masked = new Set<string>();

  mask(id: string): void {
    this.#masked.add(id);
  }

  unmask(id: string): void {
    this.#masked.delete(id);
  }

  isMasked(id: string): boolean {
    return this.#masked.has(id);
  }

  forget(id: string): void {
    this.#masked.delete(id);
  }
}
