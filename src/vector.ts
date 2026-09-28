import type { Vector } from "./types.js";

export function le(a: Vector, b: Vector): boolean {
  return a.length === b.length
    && a.every((value, index) => value <= b[index]);
}

export function ready(vt: Vector, local: Vector, sender: number): boolean {
  if (vt[sender] !== local[sender] + 1) {
    return false;
  }

  for (let index = 0; index < vt.length; index += 1) {
    if (index !== sender && vt[index] > local[index]) {
      return false;
    }
  }

  return true;
}

export function merge(local: Vector, vt: Vector): Vector {
  return local.map((value, index) => Math.max(value, vt[index]));
}
