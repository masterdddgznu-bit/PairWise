import type { LockMode } from "./types.js";
import type { LockTable } from "./locktable.js";

/** BUG: refuses S→X even when sole holder. */
export function tryUpgrade(
  table: LockTable,
  txId: string,
  key: string,
  to: LockMode,
): boolean {
  const held = table.modeOf(txId, key);
  if (!held) return false;
  if (held === to || held === "X") return true;
  if (to !== "X") return false;
  return false;
}
