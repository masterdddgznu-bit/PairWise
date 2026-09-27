import { CycleError } from "./errors.js";

/** Role inheritance graph: child inherits parent's permissions. */
export class RoleGraph {
  private readonly parents = new Map<string, Set<string>>();

  addParent(child: string, parent: string): void {
    if (child === parent || this.expand(parent).includes(child)) {
      throw new CycleError();
    }
    let set = this.parents.get(child);
    if (!set) {
      set = new Set();
      this.parents.set(child, set);
    }
    set.add(parent);
  }

  /** All roles including self, following parent links transitively. */
  expand(role: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const queue: string[] = [role];
    while (queue.length > 0) {
      const r = queue.shift() as string;
      if (seen.has(r)) continue;
      seen.add(r);
      out.push(r);
      for (const p of this.parents.get(r) ?? []) queue.push(p);
    }
    return out;
  }

  snapshot(): Map<string, Set<string>> {
    const copy = new Map<string, Set<string>>();
    for (const [k, v] of this.parents) copy.set(k, new Set(v));
    return copy;
  }

  restore(snap: Map<string, Set<string>>): void {
    this.parents.clear();
    for (const [k, v] of snap) this.parents.set(k, new Set(v));
  }
}
