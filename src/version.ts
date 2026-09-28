export type VersionNode = {
  id: number;
  key: string;
  value: string;
  refs: number;
};

/**
 * Allocates version nodes and tracks their reference counts.
 * A node stays live while HEAD or at least one snapshot references it;
 * when its refcount reaches zero it is removed from the live set.
 */
export class VersionPool {
  private nextId = 1;
  private readonly live = new Set<VersionNode>();

  alloc(_key: string, _value: string): VersionNode {
    const node: VersionNode = {
      id: this.nextId++,
      key: _key,
      value: _value,
      refs: 0,
    };
    this.live.add(node);
    this.retain(node);
    return node;
  }

  retain(node: VersionNode): void {
    node.refs += 1;
  }

  release(node: VersionNode): void {
    if (node.refs <= 0) {
      throw new Error(`Version node ${node.id} released with no references`);
    }
    node.refs -= 1;
    if (node.refs === 0) {
      this.live.delete(node);
    }
  }

  liveCount(): number {
    return this.live.size;
  }
}
