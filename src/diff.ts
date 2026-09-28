import type { DiffResult } from "./types.js";

export function diffMaps(
  _a: Map<string, string>,
  _b: Map<string, string>,
): DiffResult {
  throw new Error("diff not implemented");
}
