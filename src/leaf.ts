/** B+ tree leaf node — starter stub. */
export class LeafNode {
  next: number | null = null;

  constructor(
    public readonly id: number,
    public keys: string[] = [],
    public values: number[] = [],
  ) {}
}
