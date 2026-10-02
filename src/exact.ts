import { ExactError } from "./errors.js";

/** Exact capacity cache with lex-largest eviction (base mode). */
export class ExactCache {
  private readonly capacity: number;
  private readonly data = new Map<string, number>();

  constructor(capacity: number) {
    if (!(capacity >= 1)) throw new ExactError("invalid capacity");
    this.capacity = capacity;
  }

  get(key: string): number | undefined {
    return this.data.get(key);
  }

  put(key: string, value: number): void {
    if (this.data.has(key)) {
      this.data.set(key, value);
      return;
    }
    if (this.data.size >= this.capacity) {
      const largest = [...this.data.keys()].sort().pop()!;
      this.data.delete(largest);
    }
    this.data.set(key, value);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  size(): number {
    return this.data.size;
  }

  keys(): string[] {
    return [...this.data.keys()].sort();
  }

  clear(): void {
    this.data.clear();
  }
}
