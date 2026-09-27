import { CycleError } from "./errors.js";

export class RoleGraph {
  private readonly parents = new Map<string, Set<string>>();

  addParent(child: string, parent: string): void {
    if (child === parent) {
      throw new CycleError(`Role cycle detected: ${child} -> ${parent}`);
    }
    const parents = this.parents.get(child);
    if (parents?.has(parent)) return;
    if (this.reachable(parent, child)) {
      throw new CycleError(`Role cycle detected: ${child} -> ${parent}`);
    }
    if (!parents) this.parents.set(child, new Set([parent]));
    else parents.add(parent);
  }

  /** All roles including self, following parent links. */
  expand(role: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const queue = [role];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      out.push(current);
      for (const parent of this.parents.get(current) ?? []) queue.push(parent);
    }
    return out;
  }

  snapshot(): Map<string, Set<string>> {
    const copy = new Map<string, Set<string>>();
    for (const [role, parents] of this.parents) copy.set(role, new Set(parents));
    return copy;
  }

  restore(snapshot: Map<string, Set<string>>): void {
    this.parents.clear();
    for (const [role, parents] of snapshot) this.parents.set(role, new Set(parents));
  }

  /** True when `target` is `start` or reachable from `start` via parent links. */
  private reachable(start: string, target: string): boolean {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const parent of this.parents.get(current) ?? []) queue.push(parent);
    }
    return false;
  }
}
