import type { JobRecord } from "./types.js";
import type { JobStore } from "./job_store.js";

/** DAG helpers: cycle detection on submit + readiness for claim. */
export class DagGuard {
  constructor(private readonly store: JobStore) {}

  assertAcyclic(newId: string, deps: string[]): void {
    if (deps.includes(newId)) {
      throw new Error(`cycle detected involving ${newId}`);
    }
    for (const d of deps) {
      if (!this.store.has(d)) {
        throw new Error(`missing dependency: ${d}`);
      }
    }
    const adj = new Map<string, string[]>();
    for (const j of this.store.list()) {
      adj.set(j.id, [...j.deps]);
    }
    adj.set(newId, [...deps]);

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const dfs = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const nxt of adj.get(id) ?? []) {
        if (dfs(nxt)) return true;
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (dfs(newId)) {
      throw new Error(`cycle detected involving ${newId}`);
    }
  }

  /** Buggy: treats any non-pending dep as satisfied (failed/running count as ok). */
  isReady(job: JobRecord): boolean {
    if (job.status !== "pending") return false;
    for (const d of job.deps) {
      const dep = this.store.get(d);
      if (!dep) return false;
      if (dep.status === "pending" || dep.status === "retry_wait") {
        return false;
      }
      // running / failed / succeeded all treated as "present" — wrong for failed/running
    }
    return true;
  }
}
