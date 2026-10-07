import {
  CapacityError,
  InvalidHaulError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface LeadRecord {
  id: string;
  payload: unknown;
  openAt: number;
  closeAt: number;
  haul: number;
  seq: number;
}

export interface LeadDescriptor {
  id: string;
  payload: unknown;
  openAt: number;
  closeAt: number;
  haul: number;
}

export function describe(record: LeadRecord): LeadDescriptor {
  return {
    id: record.id,
    payload: record.payload,
    openAt: record.openAt,
    closeAt: record.closeAt,
    haul: record.haul,
  };
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(openAt: unknown, closeAt: unknown): void {
  if (
    typeof openAt !== "number" ||
    typeof closeAt !== "number" ||
    !Number.isInteger(openAt) ||
    !Number.isInteger(closeAt) ||
    openAt < 0 ||
    closeAt < 0 ||
    closeAt <= openAt
  ) {
    throw new InvalidSpanError(
      "openAt/closeAt must be integers >= 0 with closeAt > openAt",
    );
  }
}

export function validateHaul(haul: unknown): void {
  if (typeof haul !== "number" || !Number.isInteger(haul) || haul < 1) {
    throw new InvalidHaulError("haul must be an integer >= 1");
  }
}

export class LeadRegistry {
  private readonly records = new Map<string, LeadRecord>();
  private nextSeq = 0;

  constructor(private readonly maxLeads: number) {}

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
  ): "accepted" | "updated" {
    const existing = this.records.get(id);
    if (existing) {
      existing.payload = payload;
      existing.openAt = openAt;
      existing.closeAt = closeAt;
      existing.haul = haul;
      return "updated";
    }
    if (this.records.size >= this.maxLeads) {
      throw new CapacityError("maxLeads reached");
    }
    this.records.set(id, {
      id,
      payload,
      openAt,
      closeAt,
      haul,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.records.delete(id);
  }

  /** All registered records in first-registration order. */
  all(): LeadRecord[] {
    return [...this.records.values()].sort((a, b) => a.seq - b.seq);
  }

  /** Ranked order: earlier closeAt, then higher haul, then first-rig seq. */
  static ranked(records: LeadRecord[]): LeadRecord[] {
    return [...records].sort((a, b) => {
      if (a.closeAt !== b.closeAt) return a.closeAt - b.closeAt;
      if (a.haul !== b.haul) return b.haul - a.haul;
      return a.seq - b.seq;
    });
  }
}
