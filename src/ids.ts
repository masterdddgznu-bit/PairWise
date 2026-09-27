export class IdGen {
  private n = 0;
  next(): string {
    this.n += 1;
    return String(this.n);
  }
}
