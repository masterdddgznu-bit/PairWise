import { VirtualClock } from "./clock.js";
import { requireValidFence } from "./fence.js";
import { LeaseManager } from "./lease.js";
import type { LeaseInfo } from "./types.js";

/**
 * Fenced key-value store with lease fencing.
 * Without a clock it behaves as a plain in-memory Map; with a VirtualClock,
 * writes require a fence matching the current live lease.
 */
export class FencedStore {
  private readonly map = new Map<string, string>();
  private readonly lease: LeaseManager | null;
  private writerFence: number | undefined;

  constructor(clock?: VirtualClock) {
    this.lease = clock ? new LeaseManager(clock) : null;
  }

  put(key: string, value: string, fence?: number): void {
    if (this.lease !== null) {
      requireValidFence(this.lease, fence);
      this.map.set(key, value);
      this.writerFence = fence;
      return;
    }
    this.map.set(key, value);
  }

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  delete(key: string, fence?: number): boolean {
    if (this.lease !== null) {
      requireValidFence(this.lease, fence);
      const removed = this.map.delete(key);
      this.writerFence = fence;
      return removed;
    }
    return this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }

  size(): number {
    return this.map.size;
  }

  acquire(_holderId: string, _ttlMs: number): { fence: number } {
    if (!this.lease) throw new Error("acquire requires clock");
    return this.lease.acquire(_holderId, _ttlMs);
  }

  renew(_holderId: string, _fence: number, _ttlMs: number): void {
    if (!this.lease) throw new Error("renew requires clock");
    this.lease.renew(_holderId, _fence, _ttlMs);
  }

  release(_holderId: string, _fence: number): void {
    if (!this.lease) throw new Error("release requires clock");
    this.lease.release(_holderId, _fence);
  }

  currentLease(): LeaseInfo | null {
    if (!this.lease) return null;
    return this.lease.current();
  }

  lastWriterFence(): number | undefined {
    return this.writerFence;
  }
}
