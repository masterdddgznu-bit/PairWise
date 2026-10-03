/** Maps TTL to a slot index relative to the current hand. */
export class WheelIndex {
  constructor(
    private readonly slotCount: number,
    private readonly tickMs: number,
  ) {}

  slotsFromTtl(ttlMs: number): number {
    return Math.ceil(ttlMs / this.tickMs);
  }

  targetSlot(hand: number, ttlMs: number): number {
    const steps = this.slotsFromTtl(ttlMs);
    return (hand + steps) % this.slotCount;
  }
}
