export function defaultEdges(_n: number): number[][] { return []; }
export function defaultTreeEdges(_n: number): number[][] { return []; }
export function defaultClusterOf(_n: number): number[] { return []; }
export function defaultClusterRoots(_n: number): number[] { return []; }
export function buildNeighbors(_n: number, _edges: number[][]): number[][] { return []; }
export function isConnected(_n: number, _edges: number[][]): boolean { return false; }
export function isForest(_n: number, _treeEdges: number[][]): boolean { return false; }
export function orientForest(
  _n: number,
  _treeEdges: number[][],
  _clusterOf: number[],
  _clusterRoots: number[],
): { parent: Array<number | null>; children: number[][] } {
  return { parent: [], children: [] };
}
export function clusterNeighbors(
  _clusterId: number,
  _n: number,
  _edges: number[][],
  _clusterOf: number[],
): number[] {
  return [];
}
