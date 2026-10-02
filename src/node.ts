/** AVL node — starter stub. */
export class AvlNode {
  left: AvlNode | null = null;
  right: AvlNode | null = null;
  height = 1;

  constructor(
    public readonly id: number,
    public key: string,
    public value: number,
  ) {}
}

export function allocateId(_nextId: number): number {
  return _nextId;
}
