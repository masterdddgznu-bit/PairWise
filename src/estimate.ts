/** Bias correction constant alpha_m for a given register count m. */
export function alphaForM(m: number): number {
  switch (m) {
    case 16:
      return 0.673;
    case 32:
      return 0.697;
    case 64:
      return 0.709;
    default:
      return 0.7213 / (1 + 1.079 / m);
  }
}

/** Classic HLL cardinality estimate with small/large range corrections. */
export function estimateFromRegisters(regs: number[]): number {
  const m = regs.length;
  let sum = 0;
  let zeros = 0;
  for (const v of regs) {
    sum += Math.pow(2, -v);
    if (v === 0) zeros++;
  }
  let e = (alphaForM(m) * m * m) / sum;
  if (e <= 2.5 * m && zeros > 0) {
    e = m * Math.log(m / zeros);
  }
  const two32 = Math.pow(2, 32);
  if (e > two32 / 30) {
    e = -two32 * Math.log(1 - e / two32);
  }
  return Math.round(e);
}
