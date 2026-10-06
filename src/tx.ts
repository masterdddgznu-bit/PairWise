export type TxStatus = "open" | "committed" | "aborted";

export interface TxRecord {
  id: number;
  members: string[];
  deadline: number;
  status: TxStatus;
  votes: Map<string, boolean>;
}

export class TxTable {
  private txs = new Map<number, TxRecord>();
  private nextId = 1;

  create(members: string[], deadline: number): TxRecord {
    const record: TxRecord = {
      id: this.nextId++,
      members: [...members],
      deadline,
      status: "open",
      votes: new Map(),
    };
    this.txs.set(record.id, record);
    return record;
  }

  get(id: number): TxRecord | undefined {
    return this.txs.get(id);
  }

  openCount(): number {
    let count = 0;
    for (const tx of this.txs.values()) {
      if (tx.status === "open") count++;
    }
    return count;
  }

  openIds(): number[] {
    const ids: number[] = [];
    for (const tx of this.txs.values()) {
      if (tx.status === "open") ids.push(tx.id);
    }
    return ids.sort((a, b) => a - b);
  }

  expiredOpenIds(now: number): number[] {
    const ids: number[] = [];
    for (const tx of this.txs.values()) {
      if (tx.status === "open" && now >= tx.deadline) ids.push(tx.id);
    }
    return ids.sort((a, b) => a - b);
  }

  isOpenMember(participant: string): boolean {
    for (const tx of this.txs.values()) {
      if (tx.status === "open" && tx.members.includes(participant)) return true;
    }
    return false;
  }

  restore(record: TxRecord): void {
    this.txs.set(record.id, record);
    if (record.id >= this.nextId) this.nextId = record.id + 1;
  }
}
