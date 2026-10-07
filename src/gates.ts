export class DrainGates {
  #drained = new Set<string>();

  close(id: string): void {
    this.#drained.add(id);
  }

  open(id: string): void {
    this.#drained.delete(id);
  }

  isClosed(id: string): boolean {
    return this.#drained.has(id);
  }

  forget(id: string): void {
    this.#drained.delete(id);
  }
}
