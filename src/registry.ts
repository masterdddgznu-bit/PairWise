import { CapacityError, UnknownIdError } from "./errors.js";

export interface Batch {
  id: string;
  payload: unknown;
  meltAt: number;
  pourAt: number;
  flux: number;
  seq: number;
  lidded: boolean;
}

export class BatchRegistry {
  private readonly batches = new Map<string, Batch>();
  private nextSeq = 0;

  constructor(private readonly maxBatches: number) {}

  has(id: string): boolean {
    return this.batches.has(id);
  }

  get(id: string): Batch | undefined {
    return this.batches.get(id);
  }

  require(id: string): Batch {
    const batch = this.batches.get(id);
    if (!batch) {
      throw new UnknownIdError(`unknown batch id: ${id}`);
    }
    return batch;
  }

  size(): number {
    return this.batches.size;
  }

  add(id: string, payload: unknown, meltAt: number, pourAt: number, flux: number): Batch {
    if (this.batches.size >= this.maxBatches) {
      throw new CapacityError("kettle is at capacity");
    }
    const batch: Batch = {
      id,
      payload,
      meltAt,
      pourAt,
      flux,
      seq: this.nextSeq++,
      lidded: false,
    };
    this.batches.set(id, batch);
    return batch;
  }

  remove(id: string): boolean {
    return this.batches.delete(id);
  }

  inFirstLoadOrder(): Batch[] {
    return [...this.batches.values()].sort((a, b) => a.seq - b.seq);
  }
}
