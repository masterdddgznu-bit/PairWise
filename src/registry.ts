import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface RickRecord {
  id: string;
  payload: unknown;
  stackAt: number;
  forkAt: number;
  cost: number;
  sheeted: boolean;
}

export interface RickSnapshot {
  id: string;
  payload: unknown;
  stackAt: number;
  forkAt: number;
  cost: number;
}

export function snapshotOf(record: RickRecord): RickSnapshot {
  return {
    id: record.id,
    payload: record.payload,
    stackAt: record.stackAt,
    forkAt: record.forkAt,
    cost: record.cost,
  };
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError(`invalid id: ${String(id)}`);
  }
}

export function validateSpan(stackAt: unknown, forkAt: unknown): void {
  if (
    typeof stackAt !== "number" ||
    typeof forkAt !== "number" ||
    !Number.isInteger(stackAt) ||
    !Number.isInteger(forkAt) ||
    stackAt < 0 ||
    forkAt < 0 ||
    forkAt <= stackAt
  ) {
    throw new InvalidSpanError(`invalid span: [${stackAt}, ${forkAt})`);
  }
}

function validateCost(cost: unknown): void {
  if (!Number.isInteger(cost) || (cost as number) < 1) {
    throw new InvalidCostError(`invalid cost: ${String(cost)}`);
  }
}

export class RickRegistry {
  #records = new Map<string, RickRecord>();
  readonly #maxRicks: number;

  constructor(maxRicks: number) {
    this.#maxRicks = maxRicks;
  }

  size(): number {
    return this.#records.size;
  }

  ids(): string[] {
    return [...this.#records.keys()];
  }

  has(id: string): boolean {
    return this.#records.has(id);
  }

  get(id: string): RickRecord | undefined {
    return this.#records.get(id);
  }

  require(id: string): RickRecord {
    const record = this.#records.get(id);
    if (!record) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return record;
  }

  stack(
    id: string,
    payload: unknown,
    stackAt: number,
    forkAt: number,
    cost: number,
  ): "accepted" | "updated" {
    validateId(id);
    validateSpan(stackAt, forkAt);
    validateCost(cost);
    const existing = this.#records.get(id);
    if (existing) {
      existing.payload = payload;
      existing.stackAt = stackAt;
      existing.forkAt = forkAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.#records.size >= this.#maxRicks) {
      throw new CapacityError(`registry full at ${this.#maxRicks} ricks`);
    }
    this.#records.set(id, {
      id,
      payload,
      stackAt,
      forkAt,
      cost,
      sheeted: false,
    });
    return "accepted";
  }

  restack(id: string, stackAt: number, forkAt: number): boolean {
    validateId(id);
    validateSpan(stackAt, forkAt);
    const record = this.#records.get(id);
    if (!record) {
      return false;
    }
    record.stackAt = stackAt;
    record.forkAt = forkAt;
    return true;
  }

  yank(id: string): boolean {
    validateId(id);
    return this.#records.delete(id);
  }

  remove(record: RickRecord): void {
    this.#records.delete(record.id);
  }

  recordsInOrder(): RickRecord[] {
    return [...this.#records.values()];
  }
}
