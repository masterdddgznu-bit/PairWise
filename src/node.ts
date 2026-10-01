/** Skip list node: key, value, and per-level forward pointers. */
export class SkipNode {
  readonly key: string;
  value: number;
  readonly level: number;
  forward: (SkipNode | null)[];

  constructor(key: string, value: number, level: number) {
    this.key = key;
    this.value = value;
    this.level = level;
    this.forward = new Array<SkipNode | null>(level).fill(null);
  }
}
