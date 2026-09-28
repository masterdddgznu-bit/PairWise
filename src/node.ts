import type { Dot, Hint } from "./types.js";

/** Single replica: primary map + hint mailbox (starter stub). */
export class Node {
  putPrimary(_key: string, _value: string, _version: Dot): void {
    throw new Error("putPrimary not implemented");
  }

  getPrimary(_key: string): string | undefined {
    throw new Error("getPrimary not implemented");
  }

  getPrimaryEntry(_key: string): { value: string; version: Dot } | undefined {
    throw new Error("getPrimaryEntry not implemented");
  }

  storeHint(_hint: Hint): void {
    throw new Error("storeHint not implemented");
  }

  hintsFor(): Hint[] {
    return [];
  }

  takeHintsForTarget(_target: string): Hint[] {
    throw new Error("takeHintsForTarget not implemented");
  }
}
