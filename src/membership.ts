import { BarrierError } from "./errors.js";

/** Member epoch table with per-node proposals and the membership fence. */
export class MemberRegistry {
  private readonly epochs = new Map<string, number>();
  private readonly proposals = new Map<string, number>();
  private currentFence = 0;

  constructor(members: readonly string[]) {
    for (const nodeId of members) {
      if (this.epochs.has(nodeId)) {
        throw new BarrierError(`duplicate member: ${nodeId}`);
      }
      this.epochs.set(nodeId, 0);
    }
  }

  get fence(): number {
    return this.currentFence;
  }

  sortedMembers(): string[] {
    return [...this.epochs.keys()].sort();
  }

  epochOf(_nodeId: string): number {
    const epoch = this.epochs.get(_nodeId);
    if (epoch === undefined) {
      throw new BarrierError(`not a member: ${_nodeId}`);
    }
    return epoch;
  }

  minEpoch(): number {
    let min = Infinity;
    for (const epoch of this.epochs.values()) {
      if (epoch < min) {
        min = epoch;
      }
    }
    return min;
  }

  allAtLeast(_epoch: number): boolean {
    for (const epoch of this.epochs.values()) {
      if (epoch < _epoch) {
        return false;
      }
    }
    return true;
  }

  advance(_nodeId: string): number {
    const next = this.epochOf(_nodeId) + 1;
    this.epochs.set(_nodeId, next);
    this.proposals.delete(_nodeId);
    return next;
  }

  propose(_nodeId: string, _nextEpoch: number): void {
    const current = this.epochOf(_nodeId);
    if (_nextEpoch !== current + 1) {
      throw new BarrierError(
        `proposed epoch ${_nextEpoch} must be exactly ${current + 1} for ${_nodeId}`,
      );
    }
    this.proposals.set(_nodeId, _nextEpoch);
  }

  ack(_nodeId: string, _epoch: number): void {
    const current = this.epochOf(_nodeId);
    const proposed = this.proposals.get(_nodeId);
    const expected = proposed === undefined ? current + 1 : proposed;
    if (_epoch !== expected) {
      throw new BarrierError(
        `ack epoch ${_epoch} must equal ${expected} for ${_nodeId}`,
      );
    }
    this.epochs.set(_nodeId, _epoch);
    this.proposals.delete(_nodeId);
  }

  join(_nodeId: string, _atEpoch: number): void {
    if (this.epochs.has(_nodeId)) {
      throw new BarrierError(`already a member: ${_nodeId}`);
    }
    if (_atEpoch !== this.minEpoch()) {
      throw new BarrierError(
        `join epoch ${_atEpoch} must equal current minEpoch ${this.minEpoch()}`,
      );
    }
    this.epochs.set(_nodeId, _atEpoch);
    this.currentFence += 1;
  }

  leave(_nodeId: string): void {
    if (!this.epochs.delete(_nodeId)) {
      throw new BarrierError(`not a member: ${_nodeId}`);
    }
    this.proposals.delete(_nodeId);
    this.currentFence += 1;
  }

  has(_nodeId: string): boolean {
    return this.epochs.has(_nodeId);
  }
}
