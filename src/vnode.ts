import { fnv32 } from "./hash.js";

/** Virtual node positions for a physical node, ascending. */
export function vnodePositionsForNode(
  nodeId: string,
  vnodeCount: number,
  seed: number,
): number[] {
  const positions: number[] = [];
  for (let i = 0; i < vnodeCount; i++) {
    positions.push(fnv32(seed, `${nodeId}#${i}`));
  }
  return positions.sort((a, b) => a - b);
}
