export interface OarSeat {
  id: string;
  payload: unknown;
  readyAt: number;
  shipAt: number;
  strokes: number;
  seq: number;
}

export interface SeatSnapshot {
  id: string;
  payload: unknown;
  readyAt: number;
  shipAt: number;
  strokes: number;
}

export class SeatRegistry {
  private readonly seats = new Map<string, OarSeat>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.seats.has(id);
  }

  get(id: string): OarSeat | undefined {
    return this.seats.get(id);
  }

  size(): number {
    return this.seats.size;
  }

  admit(id: string, payload: unknown, readyAt: number, shipAt: number, strokes: number): OarSeat {
    const seat: OarSeat = { id, payload, readyAt, shipAt, strokes, seq: this.nextSeq++ };
    this.seats.set(id, seat);
    return seat;
  }

  remove(id: string): boolean {
    return this.seats.delete(id);
  }

  all(): OarSeat[] {
    return [...this.seats.values()];
  }

  ids(): string[] {
    return [...this.seats.keys()];
  }
}

export function snapshotOf(seat: OarSeat): SeatSnapshot {
  return {
    id: seat.id,
    payload: seat.payload,
    readyAt: seat.readyAt,
    shipAt: seat.shipAt,
    strokes: seat.strokes,
  };
}
