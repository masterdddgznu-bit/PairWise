export interface Piece<T = unknown> {
  id: string;
  payload: T;
  pegAt: number;
  strikeAt: number;
  gale: number;
  seq: number;
  hooked: boolean;
}

export type PieceSnapshot<T = unknown> = Pick<
  Piece<T>,
  "id" | "payload" | "pegAt" | "strikeAt" | "gale"
>;

export function snapshotOf<T>(piece: Piece<T>): PieceSnapshot<T> {
  return {
    id: piece.id,
    payload: piece.payload,
    pegAt: piece.pegAt,
    strikeAt: piece.strikeAt,
    gale: piece.gale,
  };
}

export class Registry<T = unknown> {
  private readonly pieces = new Map<string, Piece<T>>();
  private nextSeq = 0;

  get(id: string): Piece<T> | undefined {
    return this.pieces.get(id);
  }

  has(id: string): boolean {
    return this.pieces.has(id);
  }

  size(): number {
    return this.pieces.size;
  }

  add(id: string, payload: T, pegAt: number, strikeAt: number, gale: number): Piece<T> {
    const piece: Piece<T> = {
      id,
      payload,
      pegAt,
      strikeAt,
      gale,
      seq: this.nextSeq++,
      hooked: true,
    };
    this.pieces.set(id, piece);
    return piece;
  }

  remove(id: string): boolean {
    return this.pieces.delete(id);
  }

  inFirstHangOrder(): Piece<T>[] {
    return [...this.pieces.values()].sort((a, b) => a.seq - b.seq);
  }
}

export function compareForStrike<T>(a: Piece<T>, b: Piece<T>): number {
  if (a.strikeAt !== b.strikeAt) return b.strikeAt - a.strikeAt;
  if (a.gale !== b.gale) return a.gale - b.gale;
  return a.seq - b.seq;
}
