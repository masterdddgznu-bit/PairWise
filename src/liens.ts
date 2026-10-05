export interface Lien {
  lienId: number;
  remaining: number;
  deadline: number;
}

export class LienBook {
  private entries: Lien[] = [];
  private nextId = 1;

  add(amount: number, deadline: number): number {
    const lienId = this.nextId;
    this.nextId += 1;
    this.entries.push({ lienId, remaining: amount, deadline });
    return lienId;
  }

  wasIssued(lienId: number): boolean {
    return Number.isInteger(lienId) && lienId >= 1 && lienId < this.nextId;
  }

  private isLive(lien: Lien, now: number): boolean {
    return now < lien.deadline;
  }

  held(now: number): number {
    let total = 0;
    for (const lien of this.entries) {
      if (this.isLive(lien, now)) {
        total += lien.remaining;
      }
    }
    return total;
  }

  sweepExpired(now: number): number[] {
    const expiredIds: number[] = [];
    this.entries = this.entries.filter((lien) => {
      if (this.isLive(lien, now)) {
        return true;
      }
      expiredIds.push(lien.lienId);
      return false;
    });
    return expiredIds;
  }

  remove(lienId: number): boolean {
    const index = this.entries.findIndex((lien) => lien.lienId === lienId);
    if (index < 0) {
      return false;
    }
    this.entries.splice(index, 1);
    return true;
  }

  reduce(amount: number): number {
    let remaining = amount;
    let reduced = 0;
    while (remaining > 0 && this.entries.length > 0) {
      const head = this.entries[0];
      const take = Math.min(head.remaining, remaining);
      head.remaining -= take;
      remaining -= take;
      reduced += take;
      if (head.remaining === 0) {
        this.entries.shift();
      }
    }
    return reduced;
  }

  list(): Lien[] {
    return this.entries.map((lien) => ({ ...lien }));
  }
}
