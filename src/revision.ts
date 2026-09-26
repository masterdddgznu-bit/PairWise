/** Global monotonic revision counter — working. */
export class RevisionCounter {
  private n = 0;

  current(): number {
    return this.n;
  }

  next(): number {
    return ++this.n;
  }
}
