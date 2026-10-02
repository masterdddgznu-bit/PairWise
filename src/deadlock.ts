import { DeadlockError } from "./errors.js";

export function assertNoDeadlock(
  graph: Map<string, Set<string>>,
  from: string,
  toList: string[],
): void {
  if (!graph.has(from)) graph.set(from, new Set());
  for (const t of toList) graph.get(from)!.add(t);
  for (const start of toList) {
    const seen = new Set<string>();
    const stack: string[] = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === from) {
        throw new DeadlockError(`deadlock involving ${from}`);
      }
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of graph.get(node) ?? []) stack.push(next);
    }
  }
}
