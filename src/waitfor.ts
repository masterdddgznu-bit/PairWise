export function addEdges(
  graph: Map<string, Set<string>>,
  from: string,
  toList: string[],
): void {
  if (!graph.has(from)) graph.set(from, new Set());
  for (const to of toList) {
    graph.get(from)!.add(to);
  }
}

export function clearNode(graph: Map<string, Set<string>>, node: string): void {
  graph.delete(node);
  for (const set of graph.values()) set.delete(node);
}
