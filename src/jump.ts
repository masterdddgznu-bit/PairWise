const MASK64 = (1n << 64n) - 1n;
const MULT = 2862933555777941757n;
const TWO31 = 2147483648n;

/** Jump consistent hash loop (Lamping & Veach), uint64 arithmetic via BigInt. */
export function jumpConsistentHash(key: bigint, numBuckets: number): number {
  let b = -1n;
  let j = 0n;
  const n = BigInt(numBuckets);
  let k = key & MASK64;
  while (j < n) {
    b = j;
    k = (k * MULT + 1n) & MASK64;
    j = ((b + 1n) * TWO31) / ((k >> 33n) + 1n);
  }
  return Number(b);
}
