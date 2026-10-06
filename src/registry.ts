export interface WorkItem {
  id: string;
  payload: unknown;
  readyAt: number;
  expireAt: number;
  cost: number;
  seq: number;
  fused: boolean;
}

export interface ItemView {
  id: string;
  payload: unknown;
  readyAt: number;
  expireAt: number;
  cost: number;
}

export function viewOf(item: WorkItem): ItemView {
  return {
    id: item.id,
    payload: item.payload,
    readyAt: item.readyAt,
    expireAt: item.expireAt,
    cost: item.cost,
  };
}

export class Registry {
  private items = new Map<string, WorkItem>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  size(): number {
    return this.items.size;
  }

  add(item: Omit<WorkItem, "seq" | "fused">): WorkItem {
    const stored: WorkItem = { ...item, seq: this.nextSeq++, fused: false };
    this.items.set(item.id, stored);
    return stored;
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  all(): WorkItem[] {
    return [...this.items.values()].sort((a, b) => a.seq - b.seq);
  }

  candidates(now: number): WorkItem[] {
    return this.all()
      .filter(
        (item) => !item.fused && item.readyAt <= now && now < item.expireAt,
      )
      .sort((a, b) => a.expireAt - b.expireAt || a.seq - b.seq);
  }
}
