import { DeadlockError } from "./errors.js";

export function assertNoDeadlock(
  graph: Map<string, Set<string>>,
  from: string,
  toList: string[],
): void {
  for (const to of toList) {
    const seen = new Set<string>();
    const stack = [to];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === from) throw new DeadlockError();
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of graph.get(node) ?? []) stack.push(next);
    }
  }
}
