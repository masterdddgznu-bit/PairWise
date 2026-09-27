import type { Vote } from "./types.js";

/** Resource participant — stub. */
export class Participant {
  readonly id: number;

  constructor(id: number) {
    this.id = id;
  }

  prepare(_txId: string, _key: string, _value: string): Vote {
    return "no";
  }

  commit(_txId: string): void {
    /* stub */
  }

  abort(_txId: string): void {
    /* stub */
  }

  /** Abort even if coordinator lost state. */
  forceAbort(_txId: string): void {
    /* stub */
  }

  read(_key: string): string | undefined {
    return undefined;
  }

  inDoubtTxIds(): string[] {
    return [];
  }
}
