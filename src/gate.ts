/** Damper-pin gate: tracks which nozzle ids are pinned shut. */
export class Gate {
  private readonly pinned = new Set<string>();

  pin(id: string): void {
    this.pinned.add(id);
  }

  unpin(id: string): void {
    this.pinned.delete(id);
  }

  isPinned(id: string): boolean {
    return this.pinned.has(id);
  }

  clear(id: string): void {
    this.pinned.delete(id);
  }
}
