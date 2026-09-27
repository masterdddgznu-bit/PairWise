import type { LockMode } from "./types.js";

const MODES: LockMode[] = ["IS", "IX", "S", "SIX", "X"];

/**
 * Standard multi-granularity compatibility matrix.
 * true means a lock already held (row) permits a new request (column)
 * from a *different* txn.
 */
const MATRIX: Record<LockMode, Record<LockMode, boolean>> = {
  IS: { IS: true, IX: true, S: true, SIX: true, X: false },
  IX: { IS: true, IX: true, S: false, SIX: false, X: false },
  S: { IS: true, IX: false, S: true, SIX: false, X: false },
  SIX: { IS: true, IX: false, S: false, SIX: false, X: false },
  X: { IS: false, IX: false, S: false, SIX: false, X: false },
};

export function compatible(held: LockMode, requested: LockMode): boolean {
  return MATRIX[held][requested];
}

/**
 * Transitive "stronger than" reachability (row is weaker than column):
 * IS < S; IS < IX; S < SIX; IX < SIX; SIX < X. S and IX are incomparable.
 */
const STRONGER: Record<LockMode, LockMode[]> = {
  IS: ["S", "IX", "SIX", "X"],
  IX: ["SIX", "X"],
  S: ["SIX", "X"],
  SIX: ["X"],
  X: [],
};

export function strongerOrEqual(from: LockMode, to: LockMode): boolean {
  return from === to || STRONGER[from].includes(to);
}

/**
 * Mode subsumption / ancestor intention coverage:
 * - any held mode covers a needed IS (IS/IX/S/SIX/X)
 * - needed IX is covered by IX/SIX/X only
 * - otherwise the held mode must be stronger (or equal) in the DAG.
 */
export function covers(held: LockMode, needed: LockMode): boolean {
  if (held === needed) return true;
  if (needed === "IS") return true;
  return STRONGER[needed].includes(held);
}

/** Strict strength upgrade following the allowed paths. */
export function canUpgrade(from: LockMode, to: LockMode): boolean {
  if (from === to) return false;
  return strongerOrEqual(from, to);
}

/**
 * Least upper bound of two modes held/requested by the same txn on one
 * resource. Incomparable S and IX combine into SIX.
 */
export function lub(a: LockMode, b: LockMode): LockMode {
  if (a === b) return a;
  if (strongerOrEqual(a, b)) return b;
  if (strongerOrEqual(b, a)) return a;
  if (
    (a === "S" && b === "IX") ||
    (a === "IX" && b === "S")
  ) {
    return "SIX";
  }
  return "X";
}

export function intentionFor(leaf: LockMode): "IS" | "IX" {
  return leaf === "S" || leaf === "IS" ? "IS" : "IX";
}

export function allModes(): LockMode[] {
  return [...MODES];
}
