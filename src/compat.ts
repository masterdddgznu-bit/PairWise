import type { LockMode } from "./types.js";

const MATRIX: Record<LockMode, Record<LockMode, boolean>> = {
  IS: { IS: true, IX: true, S: true, SIX: true, X: false },
  IX: { IS: true, IX: true, S: false, SIX: false, X: false },
  S: { IS: true, IX: false, S: true, SIX: false, X: false },
  SIX: { IS: true, IX: false, S: false, SIX: false, X: false },
  X: { IS: false, IX: false, S: false, SIX: false, X: false },
};

export function compatible(held: LockMode, req: LockMode): boolean {
  return MATRIX[held][req];
}

/** held is the same as or strictly stronger than need (IX and S are incomparable). */
export function covers(held: LockMode, need: LockMode): boolean {
  if (held === need) return true;
  switch (held) {
    case "X":
      return true;
    case "SIX":
      return need === "S" || need === "IX" || need === "IS";
    case "S":
      return need === "IS";
    case "IX":
      return need === "IS";
    default:
      return false;
  }
}

export function intentionFor(mode: LockMode): LockMode {
  return mode === "IS" || mode === "S" ? "IS" : "IX";
}
