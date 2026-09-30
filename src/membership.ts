import { BarrierError } from "./errors.js";

/** Member epoch table with per-node proposals. */
export class MemberRegistry {
  private readonly epochs = new Map<string, number>();
  private readonly proposals = new Map<string, number>();

  constructor(members: string[]) {
    for (const nodeId of members) {
      if (this.epochs.has(nodeId)) {
        throw new BarrierError(`Duplicate member: ${nodeId}`);
      }
      this.epochs.set(nodeId, 0);
    }
  }

  sortedMembers(): string[] {
    return [...this.epochs.keys()].sort();
  }

  epochOf(_nodeId: string): number {
    const epoch = this.epochs.get(_nodeId);
    if (epoch === undefined) {
      throw new BarrierError(`Unknown member: ${_nodeId}`);
    }
    return epoch;
  }

  minEpoch(): number {
    if (this.epochs.size === 0) {
      return Number.POSITIVE_INFINITY;
    }
    let min = Number.POSITIVE_INFINITY;
    for (const epoch of this.epochs.values()) {
      min = Math.min(min, epoch);
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
        `Invalid proposed epoch ${_nextEpoch} for ${_nodeId}, expected ${current + 1}`,
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
        `Invalid ack epoch ${_epoch} for ${_nodeId}, expected ${expected}`,
      );
    }
    this.epochs.set(_nodeId, Math.max(current, _epoch));
    this.proposals.delete(_nodeId);
  }

  join(_nodeId: string, _atEpoch: number): void {
    if (this.epochs.has(_nodeId)) {
      throw new BarrierError(`Member already exists: ${_nodeId}`);
    }
    const minEpoch = this.minEpoch();
    if (_atEpoch !== minEpoch) {
      throw new BarrierError(
        `Cannot join ${_nodeId} at epoch ${_atEpoch}, minEpoch is ${minEpoch}`,
      );
    }
    this.epochs.set(_nodeId, _atEpoch);
  }

  leave(_nodeId: string): void {
    if (!this.epochs.delete(_nodeId)) {
      throw new BarrierError(`Unknown member: ${_nodeId}`);
    }
    this.proposals.delete(_nodeId);
  }

  has(_nodeId: string): boolean {
    return this.epochs.has(_nodeId);
  }
}
