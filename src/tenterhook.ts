import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidGaleError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { GaleLedger } from "./gale-ledger.js";
import {
  compareForStrike,
  Piece,
  PieceSnapshot,
  Registry,
  snapshotOf,
} from "./registry.js";

export interface TenterHookOptions {
  clock: VirtualClock;
  maxPieces?: number;
  initialGale?: number;
}

export interface DriveResult<T = unknown> {
  struck: Array<PieceSnapshot<T>>;
  spent: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(pegAt: number, strikeAt: number): void {
  if (
    !Number.isInteger(pegAt) ||
    !Number.isInteger(strikeAt) ||
    pegAt < 0 ||
    strikeAt < 0 ||
    strikeAt <= pegAt
  ) {
    throw new InvalidSpanError(
      "pegAt/strikeAt must be integers >= 0 with strikeAt > pegAt",
    );
  }
}

function assertValidGale(gale: number): void {
  if (!Number.isInteger(gale) || gale < 1) {
    throw new InvalidGaleError("gale must be an integer >= 1");
  }
}

export class TenterHook<T = unknown> {
  private readonly clock: VirtualClock;
  private readonly maxPieces: number;
  private readonly ledger: GaleLedger;
  private readonly registry = new Registry<T>();

  constructor(options: TenterHookOptions) {
    const maxPieces = options.maxPieces ?? 5;
    const initialGale = options.initialGale ?? 0;
    if (!Number.isInteger(maxPieces) || maxPieces < 1) {
      throw new InvalidConfigError("maxPieces must be an integer >= 1");
    }
    if (!Number.isInteger(initialGale) || initialGale < 0) {
      throw new InvalidConfigError("initialGale must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxPieces = maxPieces;
    this.ledger = new GaleLedger(initialGale);
  }

  hang(
    id: string,
    payload: T,
    pegAt: number,
    strikeAt: number,
    gale = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(pegAt, strikeAt);
    assertValidGale(gale);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.pegAt = pegAt;
      existing.strikeAt = strikeAt;
      existing.gale = gale;
      existing.hooked = true;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxPieces) {
      throw new CapacityError("registry is at capacity");
    }
    this.registry.add(id, payload, pegAt, strikeAt, gale);
    return { status: "accepted" };
  }

  restretch(id: string, pegAt: number, strikeAt: number): boolean {
    assertValidSpan(pegAt, strikeAt);
    const piece = this.registry.get(id);
    if (!piece) return false;
    piece.pegAt = pegAt;
    piece.strikeAt = strikeAt;
    piece.hooked = false;
    return true;
  }

  drop(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  hook(id: string): boolean {
    this.requirePiece(id).hooked = true;
    return true;
  }

  unhook(id: string): boolean {
    this.requirePiece(id).hooked = false;
    return true;
  }

  isHooked(id: string): boolean {
    return this.requirePiece(id).hooked;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  gale(): number {
    return this.ledger.available();
  }

  peek(): PieceSnapshot<T> | null {
    const head = this.rankedCandidates(this.clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): PieceSnapshot<T> | null {
    const now = this.clock.now();
    for (const piece of this.rankedCandidates(now)) {
      if (this.ledger.canAfford(piece.gale)) {
        this.ledger.spend(piece.gale);
        this.registry.remove(piece.id);
        return snapshotOf(piece);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.rankedCandidates(this.clock.now()).map((piece) => piece.id);
  }

  drive(): DriveResult<T> {
    const now = this.clock.now();
    const struck: Array<PieceSnapshot<T>> = [];
    for (const piece of this.rankedCandidates(now)) {
      if (this.ledger.canAfford(piece.gale)) {
        this.ledger.spend(piece.gale);
        this.registry.remove(piece.id);
        struck.push(snapshotOf(piece));
      }
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
    return this.registry.size();
  }

  spanOf(id: string): { pegAt: number; strikeAt: number } | null {
    assertValidId(id);
    const piece = this.registry.get(id);
    return piece ? { pegAt: piece.pegAt, strikeAt: piece.strikeAt } : null;
  }

  galeOf(id: string): number | null {
    assertValidId(id);
    const piece = this.registry.get(id);
    return piece ? piece.gale : null;
  }

  private requirePiece(id: string): Piece<T> {
    assertValidId(id);
    const piece = this.registry.get(id);
    if (!piece) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return piece;
  }

  private rankedCandidates(now: number): Piece<T>[] {
    return this.registry
      .inFirstHangOrder()
      .filter(
        (piece) =>
          !piece.hooked && piece.pegAt <= now && now <= piece.strikeAt,
      )
      .sort(compareForStrike);
  }
}
