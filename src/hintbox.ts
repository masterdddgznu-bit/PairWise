import type { Hint } from "./types.js";

export function sortHints(hints: Hint[]): Hint[] {
  return [...hints].sort((a, b) => {
    const t = a.target.localeCompare(b.target);
    if (t !== 0) return t;
    return a.key.localeCompare(b.key);
  });
}

/** Hint mailbox — starter stub. */
export class HintBox {
  store(_hint: Hint): void {
    throw new Error("storeHint not implemented");
  }

  forHolder(): Hint[] {
    return [];
  }

  takeForTarget(_target: string): Hint[] {
    throw new Error("takeForTarget not implemented");
  }
}
