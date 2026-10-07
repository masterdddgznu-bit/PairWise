export class BellowsGate {
  private latchedIds = new Set<string>();

  latch(id: string): void {
    this.latchedIds.add(id);
  }

  unlatch(id: string): void {
    this.latchedIds.delete(id);
  }

  isLatched(id: string): boolean {
    return this.latchedIds.has(id);
  }

  forget(id: string): void {
    this.latchedIds.delete(id);
  }
}
