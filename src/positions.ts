import { hashAt } from "./hash.js";

/** Map a key to its k counter slot positions. */
export function positionsForKey(
  key: string,
  width: number,
  hashes: number,
  seed: number,
): number[] {
  const positions = new Array<number>(hashes);
  for (let i = 0; i < hashes; i++) {
    positions[i] = hashAt(key, i, seed) % width;
  }
  return positions;
}
