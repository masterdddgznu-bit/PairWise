export interface Charge {
  id: string;
  payload: unknown;
  dunkAt: number;
  liftAt: number;
  flux: number;
  seq: number;
  clamped: boolean;
}

export interface ChargeSnapshot {
  id: string;
  payload: unknown;
  dunkAt: number;
  liftAt: number;
  flux: number;
}

export function snapshotOf(charge: Charge): ChargeSnapshot {
  return {
    id: charge.id,
    payload: charge.payload,
    dunkAt: charge.dunkAt,
    liftAt: charge.liftAt,
    flux: charge.flux,
  };
}

export class ChargeRegistry {
  #charges = new Map<string, Charge>();
  #nextSeq = 0;

  get(id: string): Charge | undefined {
    return this.#charges.get(id);
  }

  has(id: string): boolean {
    return this.#charges.has(id);
  }

  size(): number {
    return this.#charges.size;
  }

  ids(): string[] {
    return [...this.#charges.keys()];
  }

  values(): Charge[] {
    return [...this.#charges.values()];
  }

  add(id: string, payload: unknown, dunkAt: number, liftAt: number, flux: number): Charge {
    const charge: Charge = {
      id,
      payload,
      dunkAt,
      liftAt,
      flux,
      seq: this.#nextSeq++,
      clamped: true,
    };
    this.#charges.set(id, charge);
    return charge;
  }

  overwrite(charge: Charge, payload: unknown, dunkAt: number, liftAt: number, flux: number): void {
    charge.payload = payload;
    charge.dunkAt = dunkAt;
    charge.liftAt = liftAt;
    charge.flux = flux;
  }

  remove(id: string): boolean {
    return this.#charges.delete(id);
  }
}

export function compareCharges(a: Charge, b: Charge): number {
  if (a.dunkAt !== b.dunkAt) return a.dunkAt - b.dunkAt;
  if (a.flux !== b.flux) return b.flux - a.flux;
  return a.seq - b.seq;
}
