import { fnv32 } from "./hash.js";

/** Backend preference permutation over table slots. */
export function buildPermutation(
  backendId: string,
  tableSize: number,
  seed: number,
): number[] {
  const offset = fnv32(seed, backendId + ":off") % tableSize;
  const skip = (fnv32(seed, backendId + ":skip") % (tableSize - 1)) + 1;
  const perm = new Array<number>(tableSize);
  for (let j = 0; j < tableSize; j++) {
    perm[j] = (offset + j * skip) % tableSize;
  }
  return perm;
}
