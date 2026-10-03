import type { Version } from "./types.js";

export class VersionStore {
  getAt(_key: string, _epoch: number): string | undefined {
    return undefined;
  }
  append(_key: string, _epoch: number, _value: string | null): void {}
  latestEpoch(_key: string): number {
    return 0;
  }
  count(_key: string): number {
    return 0;
  }
  allKeys(): string[] {
    return [];
  }
  chain(_key: string): Version[] {
    return [];
  }
  removeAt(_key: string, _epoch: number): boolean {
    return false;
  }
}
