import type { ResourceSpec } from "./types.js";
import { InvalidConfigError } from "./errors.js";

export class ResourceTree {
  private readonly parent: Map<string, string | null>;

  constructor(resources: ResourceSpec[]) {
    if (resources.length === 0) {
      throw new InvalidConfigError("at least one resource is required");
    }
    const parent = new Map<string, string | null>();
    for (const r of resources) {
      if (parent.has(r.id)) {
        throw new InvalidConfigError(`duplicate resource id: ${r.id}`);
      }
      parent.set(r.id, r.parent);
    }
    let roots = 0;
    for (const [, p] of parent) {
      if (p === null) roots += 1;
      else if (!parent.has(p)) {
        throw new InvalidConfigError(`unknown parent resource: ${p}`);
      }
    }
    if (roots !== 1) {
      throw new InvalidConfigError("exactly one root resource is required");
    }
    for (const id of parent.keys()) {
      const seen = new Set<string>();
      let cur: string | null = id;
      while (cur !== null) {
        if (seen.has(cur)) {
          throw new InvalidConfigError(`cycle detected at resource: ${cur}`);
        }
        seen.add(cur);
        cur = parent.get(cur) ?? null;
      }
    }
    this.parent = parent;
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
    let cur = this.parentOf(id);
    while (cur !== null) {
      out.push(cur);
      cur = this.parentOf(cur);
    }
    return out.reverse();
  }

  ids(): string[] {
    return [...this.parent.keys()];
  }
}
