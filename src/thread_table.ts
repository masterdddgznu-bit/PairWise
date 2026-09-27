/** Registered threads and pin epochs — stub. */
export class ThreadTable {
  constructor(private readonly n: number) {
    void this.n;
  }

  has(_id: number): boolean {
    return false;
  }

  pin(_id: number, _epoch: number): void {
    /* stub */
  }

  unpin(_id: number): boolean {
    return false;
  }

  pinnedEpoch(_id: number): number | null {
    return null;
  }

  unregister(_id: number): void {
    /* stub */
  }

  registeredIds(): number[] {
    return [];
  }

  pinnedEpochs(): number[] {
    return [];
  }
}
