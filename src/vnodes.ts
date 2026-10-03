import { UnknownVNodeError } from "./errors.js";

export class VNodeTable {
  private readonly owners: string[];
  private readonly epochs: number[];

  constructor(vnodeCount: number, owners: string[]) {
    this.owners = new Array<string>(vnodeCount);
    this.epochs = new Array<number>(vnodeCount).fill(1);
    for (let i = 0; i < vnodeCount; i++) {
      this.owners[i] = owners[i % owners.length]!;
    }
  }
  private check(vnode: number): void {
    if (!Number.isInteger(vnode) || vnode < 0 || vnode >= this.owners.length) {
      throw new UnknownVNodeError(`unknown vnode: ${vnode}`);
    }
  }
  ownerOf(vnode: number): string {
    this.check(vnode);
    return this.owners[vnode]!;
  }
  epochOf(vnode: number): number {
    this.check(vnode);
    return this.epochs[vnode]!;
  }
  setOwner(vnode: number, ownerId: string): void {
    this.check(vnode);
    this.owners[vnode] = ownerId;
  }
  bumpEpoch(vnode: number): number {
    this.check(vnode);
    this.epochs[vnode] = this.epochs[vnode]! + 1;
    return this.epochs[vnode]!;
  }
}
