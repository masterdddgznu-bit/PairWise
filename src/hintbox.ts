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
    this.hints.push({ ...hint, version: { ...hint.version } });
  }

  forHolder(): Hint[] {
    return sortHints(this.hints);
  }

  takeForTarget(target: string): Hint[] {
    const taken = this.hints.filter((h) => h.target === target);
    this.hints = this.hints.filter((h) => h.target !== target);
    return sortHints(taken);
  }
}
