import { HintBox } from "./hintbox.js";
import { compareDots, type Dot, type Hint } from "./types.js";

/** Single replica: primary map + hint mailbox. */
export class Node {
  private readonly primary = new Map<string, { value: string; version: Dot }>();
  private readonly hintbox = new HintBox();

  putPrimary(key: string, value: string, version: Dot): void {
    const current = this.primary.get(key);
    if (!current || compareDots(version, current.version) > 0) {
      this.primary.set(key, { value, version: { ...version } });
    }
  }

  getPrimary(key: string): string | undefined {
    return this.primary.get(key)?.value;
  }

  getPrimaryEntry(key: string): { value: string; version: Dot } | undefined {
    const entry = this.primary.get(key);
    return entry ? { value: entry.value, version: { ...entry.version } } : undefined;
  }

  storeHint(hint: Hint): void {
    this.hintbox.store(hint);
  }

  hintsFor(): Hint[] {
    return this.hintbox.forHolder();
  }

  takeHintsForTarget(target: string): Hint[] {
    return this.hintbox.takeForTarget(target);
  }
}
