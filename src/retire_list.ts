import type { RetireRecord } from "./types.js";

/** Pending retire queue — stub. */
export class RetireList {
  add(_id: string, _epoch: number): void {
    /* stub */
  }

  has(_id: string): boolean {
    return false;
  }

  records(): RetireRecord[] {
    return [];
  }

  removeIds(_ids: string[]): void {
    /* stub */
  }

  size(): number {
    return 0;
  }
}
