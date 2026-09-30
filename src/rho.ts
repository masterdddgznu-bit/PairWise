/** Count leading zeros of a 32-bit unsigned value held in a JS number. */
export function leadingZeros32(w: number): number {
  return Math.clz32(w >>> 0);
}

/** Split hash h into register index and rho (1-based rank of first set bit). */
export function rhoFromHash(h: number, precision: number): { idx: number; rho: number } {
  const idx = (h >>> 0) >>> (32 - precision);
  const w = (h << precision) >>> 0;
  const rho = Math.min(leadingZeros32(w) + 1, 32 - precision + 1);
  return { idx, rho };
}
