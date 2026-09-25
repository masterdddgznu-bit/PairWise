import type { StepDef } from "./types.js";

/** DAG helpers. */
export class Graph {
  constructor(private steps: StepDef[]) {
    const ids = new Set(steps.map((s) => s.id));
    for (const s of steps) {
      for (const d of s.deps) {
        if (!ids.has(d)) throw new Error(`missing dep ${d}`);
      }
    }
  }

  ids(): string[] {
    return this.steps.map((s) => s.id);
  }

  deps(id: string): string[] {
    return [...(this.steps.find((s) => s.id === id)?.deps ?? [])];
  }

  /** Downstream dependents (one hop). */
  dependents(id: string): string[] {
    return this.steps.filter((s) => s.deps.includes(id)).map((s) => s.id);
  }

  /** Reverse topological order for compensation. */
  reverseTopo(): string[] {
    const order = this.topo();
    return order.reverse();
  }

  topo(): string[] {
    const indeg = new Map<string, number>();
    for (const s of this.steps) indeg.set(s.id, 0);
    for (const s of this.steps) {
      for (const _d of s.deps) {
        /* count edges into s */
      }
      indeg.set(s.id, s.deps.length);
    }
    const q = [...indeg.entries()].filter(([, v]) => v === 0).map(([k]) => k);
    const out: string[] = [];
    const depsOf = new Map(this.steps.map((s) => [s.id, s.deps] as const));
    const children = new Map<string, string[]>();
    for (const s of this.steps) {
      for (const d of s.deps) {
        if (!children.has(d)) children.set(d, []);
        children.get(d)!.push(s.id);
      }
    }
    while (q.length) {
      const id = q.shift()!;
      out.push(id);
      for (const c of children.get(id) ?? []) {
        const n = (indeg.get(c) ?? 1) - 1;
        indeg.set(c, n);
        if (n === 0) q.push(c);
      }
    }
    if (out.length !== this.steps.length) throw new Error("cycle");
    return out;
  }

  /**
   * Whether step is schedulable given predecessor states/results.
   * Generation alignment between predecessor runtime and its committed result
   * matters when retries bump generations.
   */
  isReady(
    id: string,
    stateOf: (id: string) => string,
    genOf: (id: string) => number,
    needGen: (dep: string) => number,
  ): boolean {
    if (stateOf(id) !== "pending" && stateOf(id) !== "failed") return false;
    for (const d of this.deps(id)) {
      if (stateOf(d) !== "succeeded") return false;
      // Incomplete: does not require genOf(d) == needGen(d)
      void needGen;
      void genOf;
    }
    return true;
  }
}
