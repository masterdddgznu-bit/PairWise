export function addEdges(
  graph: Map<string, Set<string>>,
  from: string,
  toList: string[],
): void {
  for (const to of toList) {
    if (!graph.has(to)) graph.set(to, new Set());
    graph.get(to)!.add(from);
  }
}

export function clearNode(graph: Map<string, Set<string>>, node: string): void {
  graph.delete(node);
  for (const set of graph.values()) set.delete(node);
}
