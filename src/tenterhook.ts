import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import { GaleLedger } from "./ledger.js";
import { Piece, PieceRegistry, PieceSnapshot, snapshotOf } from "./registry.js";
import {
  validateAmount,
  validateGale,
  validateId,
  validateSpan,
} from "./validate.js";

export interface TenterHookOptions {
  clock: VirtualClock;
  maxPieces?: number;
  initialGale?: number;
}

function compareRank(a: Piece, b: Piece): number {
  if (a.strikeAt !== b.strikeAt) return b.strikeAt - a.strikeAt;
  if (a.gale !== b.gale) return a.gale - b.gale;
  return a.seq - b.seq;
}

export class TenterHook {
  private readonly clock: VirtualClock;
  private readonly maxPieces: number;
  private readonly ledger: GaleLedger;
  private readonly registry = new PieceRegistry();

  constructor(options: TenterHookOptions) {
    const opts = options ?? ({} as TenterHookOptions);
    const maxPieces = opts.maxPieces ?? 5;
    const initialGale = opts.initialGale ?? 0;
    if (
      !opts.clock ||
      typeof opts.clock.now !== "function" ||
      !Number.isInteger(maxPieces) ||
      maxPieces < 1 ||
      !Number.isInteger(initialGale) ||
      initialGale < 0
    ) {
      throw new InvalidConfigError(
        "clock required; maxPieces must be an integer >= 1; initialGale an integer >= 0",
      );
    }
    this.clock = opts.clock;
    this.maxPieces = maxPieces;
    this.ledger = new GaleLedger(initialGale);
  }

  hang(
    id: string,
    payload: unknown,
    pegAt: number,
    strikeAt: number,
    gale = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(pegAt, strikeAt);
    validateGale(gale);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.pegAt = pegAt;
      existing.strikeAt = strikeAt;
      existing.gale = gale;
      existing.hooked = true;
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxPieces) {
      throw new CapacityError("maxPieces reached");
    }
    this.registry.add(id, payload, pegAt, strikeAt, gale);
    return { status: "accepted" };
  }

  restretch(id: string, pegAt: number, strikeAt: number): boolean {
    validateId(id);
    validateSpan(pegAt, strikeAt);
    const piece = this.registry.get(id);
    if (!piece) return false;
    piece.pegAt = pegAt;
    piece.strikeAt = strikeAt;
    piece.hooked = false;
    return true;
  }

  drop(id: string): boolean {
    validateId(id);
    return this.registry.remove(id);
  }

  hook(id: string): boolean {
    this.pieceOrThrow(id).hooked = true;
    return true;
  }

  unhook(id: string): boolean {
    this.pieceOrThrow(id).hooked = false;
    return true;
  }

  isHooked(id: string): boolean {
    return this.pieceOrThrow(id).hooked;
  }

  grant(amount: number): number {
    validateAmount(amount);
    return this.ledger.grant(amount);
  }

  gale(): number {
    return this.ledger.available();
  }

  peek(): PieceSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): PieceSnapshot | null {
    const next = this.candidates().find((piece) =>
      this.ledger.canAfford(piece.gale),
    );
    if (!next) return null;
    this.ledger.spend(next.gale);
    this.registry.remove(next.id);
    return snapshotOf(next);
  }

  ripeIds(): string[] {
    return this.candidates().map((piece) => piece.id);
  }

  drive(): { struck: PieceSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const live = this.candidates(now);
    const pending = new Set(live.map((piece) => piece.id));
    const struck: PieceSnapshot[] = [];
    for (;;) {
      const next = live.find(
        (piece) => pending.has(piece.id) && this.ledger.canAfford(piece.gale),
      );
      if (!next) break;
      pending.delete(next.id);
      this.ledger.spend(next.gale);
      this.registry.remove(next.id);
      struck.push(snapshotOf(next));
    }
    const spent: string[] = [];
    for (const piece of this.registry.inFirstHangOrder()) {
      if (!piece.hooked && now > piece.strikeAt) {
        this.registry.remove(piece.id);
        spent.push(piece.id);
      }
    }
    return { struck, spent };
  }

  ids(): string[] {
    return this.registry.inFirstHangOrder().map((piece) => piece.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { pegAt: number; strikeAt: number } | null {
    validateId(id);
    const piece = this.registry.get(id);
    return piece ? { pegAt: piece.pegAt, strikeAt: piece.strikeAt } : null;
  }

  galeOf(id: string): number | null {
    validateId(id);
    const piece = this.registry.get(id);
    return piece ? piece.gale : null;
  }

  private pieceOrThrow(id: string): Piece {
    validateId(id);
    const piece = this.registry.get(id);
    if (!piece) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return piece;
  }

  private candidates(now = this.clock.now()): Piece[] {
    return this.registry
      .inFirstHangOrder()
      .filter(
        (piece) =>
          !piece.hooked && piece.pegAt <= now && now <= piece.strikeAt,
      )
      .sort(compareRank);
  }
}
