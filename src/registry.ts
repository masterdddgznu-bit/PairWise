export interface Piece {
  id: string;
  payload: unknown;
  pegAt: number;
  strikeAt: number;
  gale: number;
  hooked: boolean;
  seq: number;
}

export interface PieceSnapshot {
  id: string;
  payload: unknown;
  pegAt: number;
  strikeAt: number;
  gale: number;
}

export function snapshotOf(piece: Piece): PieceSnapshot {
  return {
    id: piece.id,
    payload: piece.payload,
    pegAt: piece.pegAt,
    strikeAt: piece.strikeAt,
    gale: piece.gale,
  };
}

export class PieceRegistry {
  private readonly pieces = new Map<string, Piece>();
  private nextSeq = 0;

  get size(): number {
    return this.pieces.size;
  }

  get(id: string): Piece | undefined {
    return this.pieces.get(id);
  }

  add(id: string, payload: unknown, pegAt: number, strikeAt: number, gale: number): Piece {
    const piece: Piece = {
      id,
      payload,
      pegAt,
      strikeAt,
      gale,
      hooked: true,
      seq: this.nextSeq++,
    };
    this.pieces.set(id, piece);
    return piece;
  }

  remove(id: string): boolean {
    return this.pieces.delete(id);
  }

  inFirstHangOrder(): Piece[] {
    return [...this.pieces.values()];
  }
}
