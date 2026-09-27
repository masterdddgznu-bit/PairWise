/** Preparing deadlines — stub. */
export class TimeoutTable {
  set(_txId: string, _deadline: number): void {
    /* stub */
  }

  get(_txId: string): number | undefined {
    return undefined;
  }

  delete(_txId: string): void {
    /* stub */
  }

  due(_now: number): string[] {
    return [];
  }
}
