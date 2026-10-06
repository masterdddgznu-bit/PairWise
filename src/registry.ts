import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSoakError,
  UnknownIdError,
} from "./errors.js";

export interface HideRecord {
  id: string;
  payload: unknown;
  soakAt: number;
  drainAt: number;
  cost: number;
}

interface HideEntry extends HideRecord {
  clamped: boolean;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateWindow(soakAt: unknown, drainAt: unknown): void {
  if (
    typeof soakAt !== "number" ||
    !Number.isInteger(soakAt) ||
    soakAt < 0 ||
    typeof drainAt !== "number" ||
    !Number.isInteger(drainAt) ||
    drainAt < 0 ||
    drainAt <= soakAt
  ) {
    throw new InvalidSoakError(
      "soakAt/drainAt must be integers >= 0 with drainAt > soakAt",
    );
  }
}

function validateCost(cost: unknown): void {
  if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export class HideRegistry {
  private readonly entries = new Map<string, HideEntry>();

  constructor(private readonly maxHides: number) {}

  size(): number {
    return this.entries.size;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  load(
    id: string,
    payload: unknown,
    soakAt: number,
    drainAt: number,
    cost: number,
  ): "accepted" | "updated" {
    validateId(id);
    validateWindow(soakAt, drainAt);
    validateCost(cost);
    const existing = this.entries.get(id);
    if (existing) {
      existing.payload = payload;
      existing.soakAt = soakAt;
      existing.drainAt = drainAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.entries.size >= this.maxHides) {
      throw new CapacityError("tan pit is at capacity");
    }
    this.entries.set(id, {
      id,
      payload,
      soakAt,
      drainAt,
      cost,
      clamped: false,
    });
    return "accepted";
  }

  resoak(id: string, soakAt: number, drainAt: number): boolean {
    validateId(id);
    validateWindow(soakAt, drainAt);
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }
    entry.soakAt = soakAt;
    entry.drainAt = drainAt;
    return true;
  }

  dump(id: string): boolean {
    validateId(id);
    return this.entries.delete(id);
  }

  remove(id: string): void {
    this.entries.delete(id);
  }

  clamp(id: string): boolean {
    return this.requireEntry(id).clamped = true;
  }

  unclamp(id: string): boolean {
    this.requireEntry(id).clamped = false;
    return true;
  }

  isClamped(id: string): boolean {
    return this.requireEntry(id).clamped;
  }

  soakOf(id: string): { soakAt: number; drainAt: number } | null {
    validateId(id);
    const entry = this.entries.get(id);
    if (!entry) {
      return null;
    }
    return { soakAt: entry.soakAt, drainAt: entry.drainAt };
  }

  costOf(id: string): number | null {
    validateId(id);
    return this.entries.get(id)?.cost ?? null;
  }

  ripe(now: number): HideEntry[] {
    return this.ranked(
      [...this.entries.values()].filter(
        (entry) =>
          !entry.clamped && entry.soakAt < now && now <= entry.drainAt,
      ),
    );
  }

  oversoaked(now: number): HideEntry[] {
    return [...this.entries.values()].filter(
      (entry) => !entry.clamped && now > entry.drainAt,
    );
  }

  private ranked(entries: HideEntry[]): HideEntry[] {
    return entries.sort((a, b) => a.drainAt - b.drainAt);
  }

  private requireEntry(id: string): HideEntry {
    validateId(id);
    const entry = this.entries.get(id);
    if (!entry) {
      throw new UnknownIdError(`unknown hide id: ${id}`);
    }
    return entry;
  }
}
