export class BungGate {
  #bunged = new Set<string>();

  bung(id: string): void {
    this.#bunged.add(id);
  }

  unbung(id: string): void {
    this.#bunged.delete(id);
  }

  isBunged(id: string): boolean {
    return this.#bunged.has(id);
  }

  forget(id: string): void {
    this.#bunged.delete(id);
  }
}
