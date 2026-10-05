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

  isValid(slot: number): boolean {
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

  firstFree(): number | null {
    for (let i = 0; i < this.size; i++) {
      if (this.states[i] === null) return i;
    }
    return null;
  }

  heldSlots(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.size; i++) {
      if (this.states[i] !== null) out.push(i);
    }
    return out;
  }

  slotOfHolder(holder: string): number | null {
    for (let i = 0; i < this.size; i++) {
      if (this.states[i]?.holder === holder) return i;
    }
    return null;
  }

  expiredSlots(now: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.size; i++) {
      const s = this.states[i];
      if (s !== null && now >= s.deadline) out.push(i);
    }
    return out;
  }
}
