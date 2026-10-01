const JUMP_CONSTANT = 2862933555777941757n;
const UINT64_MASK = (1n << 64n) - 1n;
const TWO_POW_31 = 2147483648n;

/** Jump consistent hash loop (Lamping & Veach), uint64 arithmetic via BigInt. */
export function jumpConsistentHash(key: bigint, numBuckets: number): number {
  let b = -1n;
  let j = 0n;
  const n = BigInt(numBuckets);
  let k = key & UINT64_MASK;
  while (j < n) {
    b = j;
    k = (k * JUMP_CONSTANT + 1n) & UINT64_MASK;
    j = ((b + 1n) * TWO_POW_31) / ((k >> 33n) + 1n);
  }
  return Number(b);
}
