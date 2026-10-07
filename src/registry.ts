export interface Charge {
  id: string;
  payload: unknown;
  primeAt: number;
  cutoffAt: number;
  liquor: number;
  seq: number;
}

export interface ChargeView {
  id: string;
  payload: unknown;
  primeAt: number;
  cutoffAt: number;
  liquor: number;
}

export function viewOf(charge: Charge): ChargeView {
  return {
    id: charge.id,
    payload: charge.payload,
    primeAt: charge.primeAt,
    cutoffAt: charge.cutoffAt,
    liquor: charge.liquor,
  };
}

export class ChargeRegistry {
  private charges = new Map<string, Charge>();
  private nextSeq = 0;

  constructor(private readonly maxCharges: number) {}

  has(id: string): boolean {
    return this.charges.has(id);
  }

  get(id: string): Charge | undefined {
    return this.charges.get(id);
  }

  size(): number {
    return this.charges.size;
  }

  isFull(): boolean {
    return this.charges.size >= this.maxCharges;
  }

  add(
    id: string,
    payload: unknown,
    primeAt: number,
    cutoffAt: number,
    liquor: number,
  ): Charge {
    const charge: Charge = { id, payload, primeAt, cutoffAt, liquor, seq: this.nextSeq++ };
    this.charges.set(id, charge);
    return charge;
  }

  update(
    charge: Charge,
    payload: unknown,
    primeAt: number,
    cutoffAt: number,
    liquor: number,
  ): void {
    charge.payload = payload;
    charge.primeAt = primeAt;
    charge.cutoffAt = cutoffAt;
    charge.liquor = liquor;
  }

  remove(id: string): boolean {
    return this.charges.delete(id);
  }

  all(): Charge[] {
    return [...this.charges.values()];
  }
}
