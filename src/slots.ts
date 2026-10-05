export interface SlotState {
  holder: string;
  fence: number;
  deadline: number;
}

export class SlotTable {
  private readonly states: Array<SlotState | null>;

  constructor(readonly size: number) {
    this.states = new Array<SlotState | null>(size).fill(null);
  }

  isValidSlot(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0 && slot < this.size;
  }

  get(slot: number): SlotState | null {
    return this.states[slot];
  }

  grant(slot: number, holder: string, fence: number, deadline: number): void {
    this.states[slot] = { holder, fence, deadline };
  }

  free(slot: number): void {
    this.states[slot] = null;
  }

  hasFree(): boolean {
    return this.states.some((s) => s === null);
  }

  lowestFree(): number {
    return this.states.findIndex((s) => s === null);
  }

  heldSlots(): number[] {
    const held: number[] = [];
    for (let i = 0; i < this.size; i++) {
      if (this.states[i] !== null) held.push(i);
    }
    return held;
  }

  expiredSlots(now: number): number[] {
    const expired: number[] = [];
    for (let i = 0; i < this.size; i++) {
      const s = this.states[i];
      if (s !== null && now >= s.deadline) expired.push(i);
    }
    return expired;
  }
}
