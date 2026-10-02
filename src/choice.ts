export function choice(values: string[]): string {
  let best = values[0];
  for (const v of values) {
    if (v < best) best = v;
  }
  return best;
}
