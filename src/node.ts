/** Skip list node. */
export class SkipNode {
  readonly key: string;
  value: number;
  readonly level: number;
  readonly forward: (SkipNode | null)[];

  constructor(key: string, value: number, level: number) {
    this.key = key;
    this.value = value;
    this.level = level;
    this.forward = new Array<SkipNode | null>(level).fill(null);
  }
}
