export type DeadReason = "expired" | "quota_refuse";

export class DeadLetterStore {
  private readonly entries = new Map<string, DeadReason>();

  add(id: string, reason: DeadReason): void {
    if (!this.entries.has(id)) {
      this.entries.set(id, reason);
    }
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  reasonOf(id: string): DeadReason | null {
    return this.entries.get(id) ?? null;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }
}
