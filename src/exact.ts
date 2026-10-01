import { fnv1a32 } from "./hash.js";

/** FNV-indexed exact node pick (base mode). */
export class ExactNodes {
  private readonly ids = new Set<string>();

  add(id: string): void {
    this.ids.add(id);
  }

  remove(id: string): void {
    this.ids.delete(id);
  }

  list(): string[] {
    return [...this.ids].sort();
  }

  size(): number {
    return this.ids.size;
  }

  pickExact(key: string): string | null {
    const sorted = this.list();
    if (sorted.length === 0) return null;
    const idx = fnv1a32(key, 0) % sorted.length;
    return sorted[idx]!;
  }

  clear(): void {
    this.ids.clear();
  }
}
