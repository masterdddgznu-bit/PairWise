/** Fibonacci heap node — starter stub. */
export class FibNode {
  parent: FibNode | null = null;
  child: FibNode | null = null;
  left: FibNode;
  right: FibNode;
  degree = 0;
  mark = false;

  constructor(
    public readonly id: number,
    public key: string,
    public priority: number,
  ) {
    this.left = this;
    this.right = this;
  }
}

export function allocateId(_nextId: number): number {
  throw new Error("allocateId not implemented");
}
