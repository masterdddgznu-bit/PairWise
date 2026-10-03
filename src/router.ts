import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import type {
  HandoffView,
  OwnRouteOptions,
  ReadView,
  WriteResult,
} from "./types.js";

export class OwnRoute {
  readonly clock: VirtualClock;

  constructor(opts: OwnRouteOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    this.clock = opts.clock;
  }

  vnodeOf(_key: string): number {
    return 0;
  }

  ownerOf(_key: string): string {
    return "";
  }

  epochOf(_vnode: number): number {
    return 0;
  }

  fenceOf(_ownerId: string): number {
    return 0;
  }

  write(
    _ownerId: string,
    _fence: number,
    _key: string,
    _value: string,
  ): WriteResult {
    return "not_owner";
  }

  read(_key: string): ReadView | undefined {
    return undefined;
  }

  propose(_vnode: number, _toOwnerId: string, _ttlMs?: number | null): string {
    return "";
  }

  prepare(_moveId: string): void {}

  commit(_moveId: string): void {}

  abort(_moveId: string): void {}

  drive(): string[] {
    return [];
  }

  handoffOf(_vnode: number): HandoffView | undefined {
    return undefined;
  }
}
