export type VersionNode = {
  id: number;
  key: string;
  value: string;
  refs: number;
};

/**
 * Pool of version nodes with reference counting.
 * A node is "live" while refs > 0; when refs drop to 0 it is
 * removed from the live set (collected).
 */
export class VersionPool {
  private nextId = 1;
  private readonly live = new Set<VersionNode>();

  /** Allocate a node; the caller owns the first reference. */
  alloc(key: string, value: string): VersionNode {
    const node: VersionNode = { id: this.nextId++, key, value, refs: 1 };
    this.live.add(node);
    return node;
  }

  retain(node: VersionNode): void {
    node.refs += 1;
  }

  release(node: VersionNode): void {
    node.refs -= 1;
    if (node.refs <= 0) {
      this.live.delete(node);
    }
  }

  liveCount(): number {
    return this.live.size;
  }

  /** @internal Sweep any dead nodes still tracked; returns collected count. */
  sweep(): number {
    let collected = 0;
    for (const node of [...this.live]) {
      if (node.refs <= 0) {
        this.live.delete(node);
        collected += 1;
      }
    }
    return collected;
  }
}
