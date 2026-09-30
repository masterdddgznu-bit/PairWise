/** Alpha_m bias constant for the given number of registers. */
export function alphaM(m: number): number {
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

const TWO_POW_32 = 4294967296;

/**
 * Classic HyperLogLog cardinality estimate from register values:
 * raw alpha_m estimator, small-range linear counting, large-range correction.
 */
export function estimateFromRegisters(regs: number[]): number {
  const m = regs.length;

  let zeros = 0;
  let sum = 0;
  for (let j = 0; j < m; j++) {
    if (regs[j] === 0) zeros++;
    sum += 2 ** -regs[j];
  }
  if (zeros === m) return 0;

  let estimate = (alphaM(m) * m * m) / sum;

  if (estimate <= 2.5 * m && zeros > 0) {
    estimate = m * Math.log(m / zeros);
  } else if (estimate > TWO_POW_32 / 30) {
    estimate = -TWO_POW_32 * Math.log(1 - estimate / TWO_POW_32);
  }

  return Math.round(estimate);
}
