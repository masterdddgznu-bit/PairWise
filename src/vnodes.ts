import { UnknownVNodeError } from "./errors.js";

type VNodeState = {
  owner: string;
  epoch: number;
  data: Map<string, string>;
};

export class VNodeTable {
  private readonly vnodes: VNodeState[];

  constructor(vnodeCount: number, owners: string[]) {
    this.vnodes = [];
    for (let i = 0; i < vnodeCount; i++) {
      this.vnodes.push({
        owner: owners[i % owners.length]!,
        epoch: 1,
        data: new Map(),
      });
    }
  }

  get count(): number {
    return this.vnodes.length;
  }

  private state(vnode: number): VNodeState {
    const s = this.vnodes[vnode];
    if (!Number.isInteger(vnode) || s === undefined) {
      throw new UnknownVNodeError(`unknown vnode: ${vnode}`);
    }
    return s;
  }

  ownerOf(vnode: number): string {
    return this.state(vnode).owner;
  }

  epochOf(vnode: number): number {
    return this.state(vnode).epoch;
  }

  setOwner(vnode: number, ownerId: string): void {
    this.state(vnode).owner = ownerId;
  }

  bumpEpoch(vnode: number): number {
    const s = this.state(vnode);
    s.epoch += 1;
    return s.epoch;
  }

  get(vnode: number, key: string): string | undefined {
    return this.state(vnode).data.get(key);
  }

  set(vnode: number, key: string, value: string): void {
    this.state(vnode).data.set(key, value);
  }
}
