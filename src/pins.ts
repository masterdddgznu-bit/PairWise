export class PinGate {
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

  forget(id: string): void {
    this.pinned.delete(id);
  }
}
