export interface Lien {
  lienId: number;
  remaining: number;
  deadline: number;
}

export class LienBook {
  private liens: Lien[] = [];
  private nextId = 1;

  all(): Lien[] {
    return this.liens.map((l) => ({
      lienId: l.lienId,
      remaining: l.remaining,
      deadline: l.deadline,
    }));
  }

  liveHeld(now: number): number {
    let sum = 0;
    for (const l of this.liens) {
      if (now < l.deadline) sum += l.remaining;
    }
    return sum;
  }

  wasIssued(lienId: number): boolean {
    return Number.isInteger(lienId) && lienId >= 1 && lienId < this.nextId;
  }

  create(amount: number, deadline: number): number {
    const lienId = this.nextId;
    this.nextId += 1;
    this.liens.push({ lienId, remaining: amount, deadline });
    return lienId;
  }

  remove(lienId: number): boolean {
    const index = this.liens.findIndex((l) => l.lienId === lienId);
    if (index < 0) return false;
    this.liens.splice(index, 1);
    return true;
  }

  sweepExpired(now: number): number[] {
    const expired: number[] = [];
    this.liens = this.liens.filter((l) => {
      if (now < l.deadline) return true;
      expired.push(l.lienId);
      return false;
    });
    return expired;
  }

  consumeOldest(amount: number): number {
    let remaining = amount;
    let consumed = 0;
    while (remaining > 0 && this.liens.length > 0) {
      const head = this.liens[0];
      const take = Math.min(head.remaining, remaining);
      head.remaining -= take;
      remaining -= take;
      consumed += take;
      if (head.remaining === 0) this.liens.shift();
    }
    return consumed;
  }

  forceReduce(amount: number): number {
    return this.consumeOldest(amount);
  }
}
