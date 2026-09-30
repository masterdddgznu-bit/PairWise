export function defaultEdges(_n: number): number[][] { return []; }
export function buildNeighbors(_n: number, _edges: number[][]): number[][] { return []; }
export function isConnected(_n: number, _edges: number[][]): boolean { return false; }
export function isTree(_n: number, _edges: number[][]): boolean { return false; }
export function orientTree(
  _n: number,
  _edges: number[][],
  _rootId: number,
): { parent: Array<number | null>; children: number[][] } {
  return { parent: [], children: [] };
}
