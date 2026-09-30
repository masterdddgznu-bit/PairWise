/** Number of leading zero bits in a 32-bit unsigned word (32 for w === 0). */
export function leadingZeros32(w: number): number {
  return Math.clz32(w >>> 0);
}

export function rhoFromHash(h: number, precision: number): { idx: number; rho: number } {
  const idx = h >>> (32 - precision);
  const w = (h << precision) >>> 0;
  const rho = Math.min(leadingZeros32(w) + 1, 32 - precision + 1);
  return { idx, rho };
}
