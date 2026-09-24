import type { TaskId, TaskSpec, WorkflowSpec } from "./types.js";

export function assertValidDag(spec: WorkflowSpec): Map<TaskId, TaskSpec> {
  const map = new Map<TaskId, TaskSpec>();
  for (const t of spec.tasks) {
    if (map.has(t.id)) throw new Error(`duplicate task id: ${t.id}`);
    map.set(t.id, t);
  }
  for (const t of spec.tasks) {
    for (const d of t.deps) {
      if (!map.has(d)) throw new Error(`missing dep ${d} for ${t.id}`);
    }
  }
  // cycle check
  const visiting = new Set<TaskId>();
  const visited = new Set<TaskId>();
  const dfs = (id: TaskId) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`cycle at ${id}`);
    visiting.add(id);
    for (const d of map.get(id)!.deps) dfs(d);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of map.keys()) dfs(id);
  return map;
}
