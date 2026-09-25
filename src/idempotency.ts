/** Tracks executed do/undo keys to suppress duplicates on recover/tick. */
export class IdempotencyStore {
  private seen = new Set<string>();

  private key(sagaId: string, stepName: string, kind: "do" | "undo"): string {
    return `${sagaId}:${stepName}:${kind}`;
  }

  has(sagaId: string, stepName: string, kind: "do" | "undo"): boolean {
    return this.seen.has(this.key(sagaId, stepName, kind));
  }

  mark(sagaId: string, stepName: string, kind: "do" | "undo"): void {
    this.seen.add(this.key(sagaId, stepName, kind));
  }

  snapshot(): string[] {
    return [...this.seen];
  }

  restore(keys: string[]): void {
    this.seen = new Set(keys);
  }

  clear(): void {
    this.seen.clear();
  }
}
