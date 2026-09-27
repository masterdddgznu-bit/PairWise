import type { LockMode } from "./types.js";

export const LOCK_MODES: readonly LockMode[] = ["IS", "IX", "S", "SIX", "X"];

/**
 * Multi-granularity compatibility matrix.
 * Row = mode already held on the resource, column = newly requested mode.
 */
const COMPAT_MATRIX: Record<LockMode, Record<LockMode, boolean>> = {
  IS:  { IS: true,  IX: true,  S: true,  SIX: true,  X: false },
  IX:  { IS: true,  IX: true,  S: false, SIX: false, X: false },
  S:   { IS: true,  IX: false, S: true,  SIX: false, X: false },
  SIX: { IS: true,  IX: false, S: false, SIX: false, X: false },
  X:   { IS: false, IX: false, S: false, SIX: false, X: false },
};

/**
 * Strength poset edges (from weaker to stronger / covering):
 * IS < S, IS < IX, S < SIX, IX < SIX, SIX < X.
 * S and IX are incomparable.
 */
const STRONGER_DIRECT: Record<LockMode, readonly LockMode[]> = {
  IS: ["S", "IX"],
  S: ["SIX"],
  IX: ["SIX"],
  SIX: ["X"],
  X: [],
};

export function compatible(held: LockMode, requested: LockMode): boolean {
  return COMPAT_MATRIX[held][requested];
}

/** Transitive closure of modes strictly stronger than `mode`. */
function strongerThan(mode: LockMode): Set<LockMode> {
  const out = new Set<LockMode>();
  const stack = [...STRONGER_DIRECT[mode]];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (!out.has(next)) {
      out.add(next);
      stack.push(...STRONGER_DIRECT[next]);
    }
  }
  return out;
}

const STRONGER: Record<LockMode, Set<LockMode>> = {
  IS: strongerThan("IS"),
  IX: strongerThan("IX"),
  S: strongerThan("S"),
  SIX: strongerThan("SIX"),
  X: strongerThan("X"),
};

/**
 * Does `held` cover (subsume) `needed`?
 * Every mode covers itself; e.g. SIX covers both S and IX.
 */
export function covers(held: LockMode, needed: LockMode): boolean {
  return held === needed || STRONGER[needed].has(held);
}

/** Strict upgrade along the strength poset; same mode and downgrades are false. */
export function canUpgrade(from: LockMode, to: LockMode): boolean {
  return from !== to && covers(to, from);
}

/**
 * Least upper bound of two modes held/requested by the same txn on one
 * resource. Used when an ancestor already carries a mode that must also
 * cover a new intention: e.g. held S + needed IX => SIX.
 */
export function joinModes(a: LockMode, b: LockMode): LockMode {
  if (covers(a, b)) return a;
  if (covers(b, a)) return b;
  // The only incomparable pair is S vs IX, whose join is SIX.
  return "SIX";
}

/** Intention mode required on ancestors for a given leaf mode. */
export function intentionFor(leaf: LockMode): "IS" | "IX" {
  return leaf === "S" || leaf === "IS" ? "IS" : "IX";
}
