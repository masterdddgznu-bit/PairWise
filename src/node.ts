import type { RbColor } from "./types.js";

/** Red-Black node — starter stub. */
export class RbNode {
  left: RbNode | null = null;
  right: RbNode | null = null;
  parent: RbNode | null = null;
  color: RbColor = "red";

  constructor(
    public readonly id: number,
    public key: string,
    public value: number,
  ) {}
}

export function allocateId(_nextId: number): number {
  throw new Error("allocateId not implemented");
}
