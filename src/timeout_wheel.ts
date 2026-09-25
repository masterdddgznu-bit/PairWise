export type TimeoutEntry = {
  sagaId: string;
  stepName: string;
  deadline: number;
};

/** Registers step deadlines and fires overdue entries on tick. */
export class TimeoutWheel {
  private entries: TimeoutEntry[] = [];

  register(sagaId: string, stepName: string, deadline: number): void {
    this.entries.push({ sagaId, stepName, deadline });
  }

  cancel(_sagaId: string): void {
    return;
  }

  fireDue(clock: number): TimeoutEntry[] {
    const due: TimeoutEntry[] = [];
    const remain: TimeoutEntry[] = [];
    for (const e of this.entries) {
      if (clock > e.deadline) {
        due.push(e);
      } else {
        remain.push(e);
      }
    }
    this.entries = remain;
    return due;
  }

  rebuild(entries: TimeoutEntry[]): void {
    this.entries = entries.map((e) => ({ ...e }));
  }

  all(): TimeoutEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }
}
