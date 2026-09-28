export class IdRegistry {
  private readonly seen = new Set<string>();

  /** @returns true if first time */
  check(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
}
