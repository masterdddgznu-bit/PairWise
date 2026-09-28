import type { Vector } from "./types.js";

export function le(a: Vector, b: Vector): boolean {
  return a.every((value, k) => value <= b[k]);
}

export function ready(vt: Vector, local: Vector, sender: number): boolean {
  if (vt[sender] !== local[sender] + 1) return false;
  for (let k = 0; k < vt.length; k++) {
    if (k !== sender && vt[k] > local[k]) return false;
  }
  return true;
}

export function merge(local: Vector, vt: Vector): Vector {
  return local.map((value, k) => Math.max(value, vt[k]));
}
