export interface LeadRecord {
  id: string;
  payload: unknown;
  openAt: number;
  closeAt: number;
  haul: number;
  choked: boolean;
  seq: number;
}

export interface LeadDescriptor {
  id: string;
  payload: unknown;
  openAt: number;
  closeAt: number;
  haul: number;
}

export function descriptorOf(record: LeadRecord): LeadDescriptor {
  return {
    id: record.id,
    payload: record.payload,
    openAt: record.openAt,
    closeAt: record.closeAt,
    haul: record.haul,
  };
}

export class LeadRegistry {
  private readonly records = new Map<string, LeadRecord>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): LeadRecord | undefined {
    return this.records.get(id);
  }

  size(): number {
    return this.records.size;
  }

  register(
    id: string,
    payload: unknown,
    openAt: number,
    closeAt: number,
    haul: number,
  ): LeadRecord {
    const record: LeadRecord = {
      id,
      payload,
      openAt,
      closeAt,
      haul,
      choked: true,
      seq: this.nextSeq++,
    };
    this.records.set(id, record);
    return record;
  }

  remove(id: string): boolean {
    return this.records.delete(id);
  }

  all(): LeadRecord[] {
    return [...this.records.values()].sort((a, b) => a.seq - b.seq);
  }
}

export function isLive(record: LeadRecord, now: number): boolean {
  return record.openAt <= now && now < record.closeAt;
}

export function isSlipped(record: LeadRecord, now: number): boolean {
  return now >= record.closeAt;
}

export function compareHaulRank(a: LeadRecord, b: LeadRecord): number {
  if (a.closeAt !== b.closeAt) return a.closeAt - b.closeAt;
  if (a.haul !== b.haul) return b.haul - a.haul;
  return a.seq - b.seq;
}
