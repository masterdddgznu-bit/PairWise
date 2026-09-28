import type { VersionNode, VersionPool } from "./version.js";

/**
 * A root maps live keys to version nodes. HEAD owns one mutable root;
 * every snapshot holds an immutable copy of the root map, so unchanged
 * keys share the same version nodes (copy-on-write).
 */
export class MapRoot {
  private readonly map = new Map<string, VersionNode>();

  constructor(private readonly pool?: VersionPool, entries?: ReadonlyMap<string, VersionNode>) {
    if (entries) {
      for (const [key, node] of entries) this.map.set(key, node);
    }
  }

  /** CoW put: allocates a fresh version node and releases the old one. */
  put(key: string, value: string): void {
    if (!this.pool) throw new Error("MapRoot without a VersionPool cannot put");
    const old = this.map.get(key);
    const node = this.pool.alloc(key, value);
    this.map.set(key, node);
    if (old) this.pool.release(old);
  }

  get(key: string): string | undefined {
    return this.map.get(key)?.value;
  }

  getNode(key: string): VersionNode | undefined {
    return this.map.get(key);
  }

  /** CoW delete: drops the key and releases the version node. */
  delete(key: string): boolean {
    if (!this.pool) throw new Error("MapRoot without a VersionPool cannot delete");
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

  entries(): IterableIterator<[string, VersionNode]> {
    return this.map.entries();
  }

  size(): number {
    return this.map.size;
  }

  /** Immutable snapshot root: shares every version node (no ref changes). */
  clone(): MapRoot {
    return new MapRoot(this.pool, this.map);
  }

  retainAll(): void {
    if (!this.pool) throw new Error("MapRoot without a VersionPool cannot retain");
    for (const node of this.map.values()) this.pool.retain(node);
  }

  releaseAll(): void {
    if (!this.pool) throw new Error("MapRoot without a VersionPool cannot release");
    for (const node of this.map.values()) this.pool.release(node);
  }

  /** Replaces HEAD content with an independent copy of another root. */
  replaceWith(other: MapRoot): void {
    if (!this.pool) throw new Error("MapRoot without a VersionPool cannot replace");
    other.retainAll();
    this.releaseAll();
    this.map.clear();
    for (const [key, node] of other.entries()) this.map.set(key, node);
  }
}
