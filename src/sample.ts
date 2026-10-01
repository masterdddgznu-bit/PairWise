import { LcgRng } from "./rng.js";

/** Fisher-Yates shuffle (tail to head) driven by a seeded LCG. */
export function fisherYatesSample(items: string[], seed: number): string[] {
  const result = [...items];
  const rng = new LcgRng(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}
