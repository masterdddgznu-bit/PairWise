import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import type { CommittedEntry, ViewLogOptions } from "./types.js";

export class ViewLog {
  readonly procClock: VirtualClock;

  constructor(opts: ViewLogOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    this.procClock = opts.clock;
  }

  view(): number {
    return 1;
  }

  primary(): string {
    return "";
  }

  append(_asReplica: string, _payload: string): number {
    return 0;
  }

  ack(_replica: string, _view: number, _index: number): boolean {
    return false;
  }

  get(_index: number): CommittedEntry | undefined {
    return undefined;
  }

  lastIndex(): number {
    return 0;
  }

  commitIndex(): number {
    return 0;
  }

  ackedBy(_index: number): string[] {
    return [];
  }

  viewChange(_newView: number): void {}

  drive(): number[] {
    return [];
  }

  exportState(): string {
    return "{}";
  }

  importState(_json: string): void {}
}
