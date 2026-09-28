import { HintBox } from "./hintbox.js";
import { compareDots, type Dot, type Hint } from "./types.js";

/** Single replica: primary map + hint mailbox. */
export class Node {
  private readonly primary = new Map<string, { value: string; version: Dot }>();
  private readonly mailbox = new HintBox();

  constructor(readonly id: string) {}

  putPrimary(key: string, value: string, version: Dot): void {
    const existing = this.primary.get(key);
    if (!existing || compareDots(version, existing.version) > 0) {
      this.primary.set(key, { value, version });
    }
  }

  getPrimary(key: string): string | undefined {
    return this.primary.get(key)?.value;
  }

  getPrimaryEntry(key: string): { value: string; version: Dot } | undefined {
    return this.primary.get(key);
  }

  storeHint(hint: Hint): void {
    this.mailbox.store(hint);
  }

  hintsFor(): Hint[] {
    return this.mailbox.forHolder();
  }

  takeHintsForTarget(target: string): Hint[] {
    return this.mailbox.takeForTarget(target);
  }
}
