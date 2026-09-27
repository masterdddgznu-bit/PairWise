import type { DiffOp, Entry } from "./types.js";

export function diffEntries(_local: Entry[], _remote: Entry[]): DiffOp[] {
  throw new Error("diffEntries not implemented");
}

export function winner(_a: Entry | undefined, _b: Entry | undefined): Entry | undefined {
  throw new Error("winner not implemented");
}
