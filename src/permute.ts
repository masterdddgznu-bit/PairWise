import { fnv32 } from "./hash.js";

/** Backend preference permutation. */
export function buildPermutation(
  backendId: string,
  tableSize: number,
  seed: number,
): number[] {
  const offset = fnv32(seed, backendId + ":off") % tableSize;
  const skip = (fnv32(seed, backendId + ":skip") % (tableSize - 1)) + 1;
  const permutation: number[] = new Array<number>(tableSize);
  for (let j = 0; j < tableSize; j++) {
    permutation[j] = (offset + j * skip) % tableSize;
  }
  return permutation;
}
