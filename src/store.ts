import { VirtualClock } from "./clock.js";
import type { TxStatus } from "./types.js";

/**
 * Snapshot-isolation store with SSI write-skew detection (feature incomplete).
 * Base put/get/delete/has/keys/size work.
 */
export class SkewStore {
  readonly clock: VirtualClock;
  private readonly map = new Map<string, string>();

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
  }

  put(key: string, value: string): void {
    this.map.set(key, value);
  }

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  delete(key: string): boolean {
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

  begin(): string {
    throw new Error("begin not implemented");
  }

  read(_tx: string, _key: string): string | undefined {
    throw new Error("read not implemented");
  }

  write(_tx: string, _key: string, _value: string): void {
    throw new Error("write not implemented");
  }

  deleteTx(_tx: string, _key: string): void {
    throw new Error("deleteTx not implemented");
  }

  commit(_tx: string): void {
    throw new Error("commit not implemented");
  }

  abort(_tx: string): void {
    throw new Error("abort not implemented");
  }

  status(_tx: string): TxStatus {
    throw new Error("status not implemented");
  }

  committedValue(_key: string): string | undefined {
    throw new Error("committedValue not implemented");
  }

  commitTs(): number {
    throw new Error("commitTs not implemented");
  }
}
