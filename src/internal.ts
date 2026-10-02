/** B+ tree internal node — starter stub. */
export class InternalNode {
  constructor(
    public readonly id: number,
    public keys: string[] = [],
    public children: number[] = [],
  ) {}
}
