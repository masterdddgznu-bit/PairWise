import type { GKTuple } from "./types.js";

/** Tuple helpers. */
export function sortTuples(tuples: GKTuple[]): GKTuple[] {
  return [...tuples].sort((a, b) => a.value - b.value);
}

export function mergeTuplesByValue(left: GKTuple[], right: GKTuple[]): GKTuple[] {
  const merged: GKTuple[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i]!;
    const b = right[j]!;
    if (a.value < b.value) {
      merged.push({ ...a });
      i += 1;
    } else if (b.value < a.value) {
      merged.push({ ...b });
      j += 1;
    } else {
      merged.push({ value: a.value, g: a.g + b.g, delta: Math.max(a.delta, b.delta) });
      i += 1;
      j += 1;
    }
  }
  for (; i < left.length; i += 1) merged.push({ ...left[i]! });
  for (; j < right.length; j += 1) merged.push({ ...right[j]! });
  return merged;
}
