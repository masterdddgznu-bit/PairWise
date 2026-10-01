import type { WeightedEdge } from "./types.js";
export function defaultEdges(_n: number): WeightedEdge[] { return []; }
export function edgeKey(_u: number, _v: number): string { return ""; }
export function buildNeighbors(_n: number, _edges: WeightedEdge[]): Array<Array<{ id: number; w: number }>> { return []; }
export function isConnected(_n: number, _edges: WeightedEdge[]): boolean { return false; }
