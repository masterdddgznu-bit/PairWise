/** Maps TTL to a slot index relative to the current hand. */
export class WheelIndex {
  constructor(
    private readonly slotCount: number,
    private readonly tickMs: number,
  ) {}

  /** Ticks until a span elapses; always lands at least one slot ahead. */
  slotsForSpan(spanMs: number): number {
    return Math.max(1, Math.ceil(spanMs / this.tickMs));
  }

  /** Slot the hand will be on at the first tick boundary >= expireAt. */
  targetSlot(hand: number, handTime: number, expireAt: number): number {
    const steps = this.slotsForSpan(expireAt - handTime);
    return (hand + steps) % this.slotCount;
  }
}
