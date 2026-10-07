export class StopGate {
  #stopped = new Set<string>();

  arm(id: string): void {
    this.#stopped.add(id);
  }

  release(id: string): void {
    this.#stopped.delete(id);
  }

  forget(id: string): void {
    this.#stopped.delete(id);
  }

  isStopped(id: string): boolean {
    return this.#stopped.has(id);
  }
}
