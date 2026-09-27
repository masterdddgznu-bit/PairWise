export class BallotAllocator {
  private n = 0;
  next(): number { this.n += 1; return this.n; }
  current(): number { return this.n; }
}
