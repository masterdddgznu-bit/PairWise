export class StopLatch {
  private readonly stopped = new Set<string>();

  engage(id: string): void {
    this.stopped.add(id);
  }

  release(id: string): void {
    this.stopped.delete(id);
  }

  isStopped(id: string): boolean {
    return this.stopped.has(id);
  }

  forget(id: string): void {
    this.stopped.delete(id);
  }
}
