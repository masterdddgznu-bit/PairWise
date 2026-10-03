import type { LockMode } from "./types.js";

const MATRIX: Record<LockMode, Record<LockMode, boolean>> = {
  IS: { IS: true, IX: true, S: true, SIX: true, X: false },
  IX: { IS: true, IX: true, S: false, SIX: false, X: false },
  S: { IS: true, IX: false, S: true, SIX: false, X: false },
  SIX: { IS: true, IX: false, S: false, SIX: false, X: false },
  X: { IS: false, IX: false, S: false, SIX: false, X: false },
};

/** Modes that `held` is at least as strong as (reflexive). */
const COVERS: Record<LockMode, readonly LockMode[]> = {
  IS: ["IS"],
  IX: ["IS", "IX"],
  S: ["IS", "S"],
  SIX: ["IS", "IX", "S", "SIX"],
  X: ["IS", "IX", "S", "SIX", "X"],
};

export function compatible(held: LockMode, req: LockMode): boolean {
  return MATRIX[held][req];
}

export function covers(held: LockMode, need: LockMode): boolean {
  return COVERS[held].includes(need);
}

export function intentionFor(mode: LockMode): LockMode {
  return mode === "IS" || mode === "S" ? "IS" : "IX";
}

/** Least mode covering both `a` and `b` (used for upgrades). */
export function mergeModes(a: LockMode, b: LockMode): LockMode {
  if (covers(a, b)) return a;
  if (covers(b, a)) return b;
  // Only incomparable pair is IX vs S; their join is SIX.
  return "SIX";
}
