import { UnknownOwnerError } from "./errors.js";

export class OwnerBook {
  private readonly sortedIds: string[];
  private readonly fences = new Map<string, number>();

  constructor(ownerIds: string[]) {
    this.sortedIds = [...ownerIds].sort();
    for (const id of this.sortedIds) {
      this.fences.set(id, 1);
    }
  }
  has(id: string): boolean {
    return this.fences.has(id);
  }
  fenceOf(id: string): number {
    const fence = this.fences.get(id);
    if (fence === undefined) throw new UnknownOwnerError(`unknown owner: ${id}`);
    return fence;
  }
  bump(id: string): number {
    const next = this.fenceOf(id) + 1;
    this.fences.set(id, next);
    return next;
  }
  ids(): string[] {
    return [...this.sortedIds];
  }
}
