import type { VersionNode, VersionPool } from "./version.js";

/**
 * A root maps keys to version nodes. HEAD is a mutable root;
 * snapshots are roots that are never mutated after creation.
 * Roots share nodes via the pool's reference counting (copy-on-write).
 */
export class MapRoot {
  private readonly map = new Map<string, VersionNode>();

  constructor(private readonly pool: VersionPool) {}

  /** Create a root that shares (retains) all nodes of `other`. */
  static share(pool: VersionPool, other: MapRoot): MapRoot {
    const root = new MapRoot(pool);
    for (const [key, node] of other.map) {
      pool.retain(node);
      root.map.set(key, node);
    }
    return root;
  }

  put(key: string, value: string): void {
    const old = this.map.get(key);
    const node = this.pool.alloc(key, value);
    if (old) this.pool.release(old);
    this.map.set(key, node);
  }

  get(key: string): string | undefined {
    return this.map.get(key)?.value;
  }

  delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.map.delete(key);
    this.pool.release(node);
    return true;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }

  size(): number {
    return this.map.size;
  }

  /** Reset this root to share the contents of `other` (used by fork). */
  replaceWith(other: MapRoot): void {
    this.releaseAll();
    for (const [key, node] of other.map) {
      this.pool.retain(node);
      this.map.set(key, node);
    }
  }

  /** Drop all references held by this root. */
  releaseAll(): void {
    for (const node of this.map.values()) this.pool.release(node);
    this.map.clear();
  }

  /** Plain key -> value view (for diffing). */
  toDataMap(): Map<string, string> {
    const data = new Map<string, string>();
    for (const [key, node] of this.map) data.set(key, node.value);
    return data;
  }
}
