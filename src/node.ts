/** Treap node: BST by key, max-heap by priority. */
export class TreapNode {
  left: TreapNode | null = null;
  right: TreapNode | null = null;

  constructor(
    public key: string,
    public value: number,
    public priority: number,
  ) {}
}
