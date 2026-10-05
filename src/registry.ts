export type ItemState = "unstamped" | "stamped";

export interface RegisteredItem {
  readonly id: string;
  readonly payload: unknown;
  /** Monotonic offer order, fixes the final tie-break. */
  readonly offerSeq: number;
  state: ItemState;
  stamp: number | null;
  /** Global event seq of the stamp/restamp that set the current stamp value. */
  stampSeq: number | null;
}

/** Dual-state registry of all live items, keyed by id, ordered by offer. */
export class Registry {
  private readonly items = new Map<string, RegisteredItem>();

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): RegisteredItem | undefined {
    return this.items.get(id);
  }

  add(item: RegisteredItem): void {
    this.items.set(item.id, item);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  get size(): number {
    return this.items.size;
  }

  idsInOfferOrder(): string[] {
    return [...this.items.values()].map((item) => item.id);
  }

  /** Releasable items gated by the watermark, in pop selection order. */
  releasable(watermark: number): RegisteredItem[] {
    return [...this.items.values()]
      .filter(
        (item) =>
          item.state === "stamped" && item.stamp !== null && item.stamp <= watermark,
      )
      .sort(compareReleasable);
  }
}

function compareReleasable(a: RegisteredItem, b: RegisteredItem): number {
  const stampA = a.stamp as number;
  const stampB = b.stamp as number;
  if (stampA !== stampB) return stampA - stampB;
  const seqA = a.stampSeq as number;
  const seqB = b.stampSeq as number;
  if (seqA !== seqB) return seqA - seqB;
  return a.offerSeq - b.offerSeq;
}
