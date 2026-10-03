import type { ResourceSpec } from "./types.js";
import { InvalidConfigError } from "./errors.js";

export class ResourceTree {
  private readonly parent = new Map<string, string | null>();

  constructor(resources: ResourceSpec[]) {
    if (resources.length === 0) {
      throw new InvalidConfigError("resources must not be empty");
    }
    for (const r of resources) {
      if (this.parent.has(r.id)) {
        throw new InvalidConfigError(`duplicate resource id: ${r.id}`);
      }
      this.parent.set(r.id, r.parent);
    }
    const roots = resources.filter((r) => r.parent === null);
    if (roots.length !== 1) {
      throw new InvalidConfigError("expected exactly one root");
    }
    for (const r of resources) {
      if (r.parent !== null && !this.parent.has(r.parent)) {
        throw new InvalidConfigError(`unknown parent: ${r.parent}`);
      }
    }
    // Cycle check: following parents from any node must terminate at the root.
    for (const r of resources) {
      const seen = new Set<string>();
      let cur: string | null = r.id;
      while (cur !== null) {
        if (seen.has(cur)) {
          throw new InvalidConfigError("cycle detected in resource tree");
        }
        seen.add(cur);
        cur = this.parent.get(cur) ?? null;
      }
    }
  }

  has(id: string): boolean {
    return this.parent.has(id);
  }

  parentOf(id: string): string | null {
    return this.parent.get(id) ?? null;
  }

  /** root → … → node (excluding node) */
  ancestors(id: string): string[] {
    const out: string[] = [];
    let cur = this.parent.get(id) ?? null;
    while (cur !== null) {
      out.push(cur);
      cur = this.parent.get(cur) ?? null;
    }
    return out.reverse();
  }

  ids(): string[] {
    return [...this.parent.keys()];
  }
}
