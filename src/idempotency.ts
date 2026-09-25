/** Tracks executed do/undo keys to suppress duplicates on recover/tick. */
export class IdempotencyStore {
  private seen = new Set<string>();

  private key(stepName: string, kind: "do" | "undo"): string {
    return `${stepName}:${kind}`;
  }

  has(_sagaId: string, stepName: string, kind: "do" | "undo"): boolean {
    return this.seen.has(this.key(stepName, kind));
  }

  mark(_sagaId: string, stepName: string, kind: "do" | "undo"): void {
    this.seen.add(this.key(stepName, kind));
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
