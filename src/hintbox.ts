import type { Hint } from "./types.js";

export function sortHints(hints: Hint[]): Hint[] {
  return [...hints].sort((a, b) => {
    const t = a.target.localeCompare(b.target);
    if (t !== 0) return t;
    return a.key.localeCompare(b.key);
  });
}

/** Hint mailbox for a single holder node. */
export class HintBox {
  private hints: Hint[] = [];

  store(hint: Hint): void {
    this.hints.push(hint);
  }

  forHolder(): Hint[] {
    return sortHints(this.hints);
  }

  takeForTarget(target: string): Hint[] {
    const taken: Hint[] = [];
    const kept: Hint[] = [];
    for (const hint of this.hints) {
      if (hint.target === target) taken.push(hint);
      else kept.push(hint);
    }
    this.hints = kept;
    return sortHints(taken);
  }
}
