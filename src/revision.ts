export class RevisionCounter {
  private n = 0;

  current(): number {
    return this.n;
  }

  next(): number {
    return ++this.n;
  }

  /** Used by restore. */
  set(n: number): void {
    this.n = n;
  }
}
