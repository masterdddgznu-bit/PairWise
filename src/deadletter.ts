export type DeadReason = "expired" | "quota_refuse";

export interface DeadEntry<TItem> {
  item: TItem;
  reason: DeadReason;
}

export class DeadLetters<TItem extends { id: string }> {
  private readonly entries = new Map<string, DeadEntry<TItem>>();

  add(item: TItem, reason: DeadReason): void {
    this.entries.set(item.id, { item, reason });
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  reason(id: string): DeadReason | null {
    return this.entries.get(id)?.reason ?? null;
  }

  take(id: string): TItem | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.entries.delete(id);
    return entry.item;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }
}
