import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InFlightError,
  InvalidConfigError,
  InvalidMoveError,
  NotOwnerError,
  UnknownKeyError,
  UnknownShardError,
  UnknownTicketError,
} from "./errors.js";

export interface CutMeshConfig {
  clock: VirtualClock;
  shards: string[];
  dualWriteMs: number;
  drainTimeoutMs: number;
  leaseMs: number;
}

export type MovePhase = "dual" | "draining";
export type MoveStatus = "dual" | "draining" | "cut" | "aborted";

export interface DriveReport {
  expiredWrites: number[];
  forcedAbort: number[];
  autoCut: number[];
}

interface InflightWrite {
  ticket: number;
  fence: number;
  shard: string;
  leaseDeadline: number;
}

interface Move {
  id: number;
  key: string;
  from: string;
  to: string;
  shadow: string;
  caughtUp: boolean;
  phase: MovePhase;
  startedAt: number;
  dualDeadline: number;
  drainDeadline?: number;
}

interface KeyState {
  owner: string;
  gen: number;
  value: string;
  inflight?: InflightWrite;
  move?: Move;
}

export class CutMesh {
  private readonly clock: VirtualClock;
  private readonly shards: string[];
  private readonly dualWriteMs: number;
  private readonly drainTimeoutMs: number;
  private readonly leaseMs: number;

  private readonly keys = new Map<string, KeyState>();
  private readonly moves = new Map<number, Move>();
  private readonly finishedMoves = new Map<number, "cut" | "aborted">();
  private readonly inflightByTicket = new Map<number, string>();

  private nextTicket = 1;
  private nextFence = 1;
  private nextMoveId = 1;

  constructor(config: CutMeshConfig) {
    if (
      !config ||
      !(config.clock instanceof VirtualClock) ||
      !Array.isArray(config.shards) ||
      config.shards.length === 0 ||
      new Set(config.shards).size !== config.shards.length ||
      !config.shards.every((s) => typeof s === "string" && s.length > 0) ||
      !CutMesh.isValidMs(config.dualWriteMs) ||
      !CutMesh.isValidMs(config.drainTimeoutMs) ||
      !CutMesh.isValidMs(config.leaseMs)
    ) {
      throw new InvalidConfigError("invalid CutMesh configuration");
    }
    this.clock = config.clock;
    this.shards = [...config.shards].sort();
    this.dualWriteMs = config.dualWriteMs;
    this.drainTimeoutMs = config.drainTimeoutMs;
    this.leaseMs = config.leaseMs;
  }

  private static isValidMs(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 1;
  }

  private keyState(key: string): KeyState {
    const state = this.keys.get(key);
    if (!state) {
      throw new UnknownKeyError(`unknown key: ${key}`);
    }
    return state;
  }

  private requireShard(shard: string): void {
    if (!this.shards.includes(shard)) {
      throw new UnknownShardError(`unknown shard: ${shard}`);
    }
  }

  private requireActiveMove(moveId: number): Move {
    const move = this.moves.get(moveId);
    if (!move) {
      throw new InvalidMoveError(`unknown move: ${moveId}`);
    }
    return move;
  }

  place(key: string, value: string, shard: string): void {
    this.requireShard(shard);
    if (this.keys.has(key)) {
      throw new InvalidMoveError(`key already exists: ${key}`);
    }
    this.keys.set(key, { owner: shard, gen: 1, value });
  }

  ownerOf(key: string): string {
    return this.keyState(key).owner;
  }

  genOf(key: string): number {
    return this.keyState(key).gen;
  }

  get(key: string): string {
    return this.keyState(key).value;
  }

  beginWrite(key: string, shard: string, gen: number): { ticket: number; fence: number } {
    const state = this.keyState(key);
    if (gen !== state.gen) {
      throw new FenceError(`stale gen ${gen}, current gen is ${state.gen}`);
    }
    const move = state.move;
    const allowed = move ? shard === move.from || shard === move.to : shard === state.owner;
    if (!allowed) {
      throw new NotOwnerError(`shard ${shard} may not write key ${key}`);
    }
    if (move && move.phase === "draining") {
      throw new InvalidMoveError(`key ${key} is draining; no new writes`);
    }
    if (state.inflight) {
      throw new InFlightError(`key ${key} already has an inflight write`);
    }
    const ticket = this.nextTicket++;
    const fence = this.nextFence++;
    state.inflight = {
      ticket,
      fence,
      shard,
      leaseDeadline: this.clock.now() + this.leaseMs,
    };
    this.inflightByTicket.set(ticket, key);
    return { ticket, fence };
  }

  private findInflight(ticket: number, fence: number): { key: string; state: KeyState; write: InflightWrite } {
    const key = this.inflightByTicket.get(ticket);
    if (key === undefined) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    const state = this.keys.get(key)!;
    const write = state.inflight!;
    if (write.fence !== fence) {
      throw new FenceError(`fence mismatch for ticket ${ticket}`);
    }
    return { key, state, write };
  }

  private clearInflight(key: string, state: KeyState, ticket: number): void {
    state.inflight = undefined;
    this.inflightByTicket.delete(ticket);
    if (state.move && state.move.phase === "draining") {
      this.cut(state.move);
    }
  }

  endWrite(ticket: number, fence: number, value: string): boolean {
    const { key, state, write } = this.findInflight(ticket, fence);
    const move = state.move;
    if (move && write.shard === move.to) {
      move.shadow = value;
    } else {
      state.value = value;
      if (move) {
        move.shadow = value;
      }
    }
    this.clearInflight(key, state, ticket);
    return true;
  }

  cancelWrite(ticket: number, fence: number): boolean {
    const { key, state } = this.findInflight(ticket, fence);
    this.clearInflight(key, state, ticket);
    return true;
  }

  beginMove(key: string, toShard: string): number {
    const state = this.keyState(key);
    this.requireShard(toShard);
    if (toShard === state.owner) {
      throw new InvalidMoveError(`key ${key} is already owned by ${toShard}`);
    }
    if (state.move) {
      throw new InvalidMoveError(`key ${key} already has an active move`);
    }
    if (state.inflight) {
      throw new InFlightError(`key ${key} has an inflight write`);
    }
    const now = this.clock.now();
    const move: Move = {
      id: this.nextMoveId++,
      key,
      from: state.owner,
      to: toShard,
      shadow: state.value,
      caughtUp: false,
      phase: "dual",
      startedAt: now,
      dualDeadline: now + this.dualWriteMs,
    };
    state.move = move;
    this.moves.set(move.id, move);
    return move.id;
  }

  ackCatchup(moveId: number, shard: string): boolean {
    const move = this.requireActiveMove(moveId);
    if (move.phase !== "dual" || shard !== move.to) {
      return false;
    }
    move.caughtUp = true;
    return true;
  }

  requestCut(moveId: number): boolean {
    const move = this.requireActiveMove(moveId);
    if (move.phase !== "dual" || !move.caughtUp) {
      return false;
    }
    const state = this.keys.get(move.key)!;
    if (state.inflight) {
      throw new InFlightError(`key ${move.key} has an inflight write`);
    }
    move.phase = "draining";
    move.drainDeadline = this.clock.now() + this.drainTimeoutMs;
    this.cut(move);
    return true;
  }

  requestAbort(moveId: number): boolean {
    const move = this.requireActiveMove(moveId);
    this.abort(move);
    return true;
  }

  cutover(moveId: number): boolean {
    const move = this.requireActiveMove(moveId);
    if (move.phase !== "draining") {
      return false;
    }
    const state = this.keys.get(move.key)!;
    if (state.inflight) {
      throw new InFlightError(`key ${move.key} has an inflight write`);
    }
    this.cut(move);
    return true;
  }

  private cut(move: Move): void {
    const state = this.keys.get(move.key)!;
    state.owner = move.to;
    state.gen += 1;
    state.value = move.shadow;
    state.move = undefined;
    this.moves.delete(move.id);
    this.finishedMoves.set(move.id, "cut");
  }

  private abort(move: Move): void {
    const state = this.keys.get(move.key)!;
    state.move = undefined;
    this.moves.delete(move.id);
    this.finishedMoves.set(move.id, "aborted");
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const expiredWrites: number[] = [];
    const forcedAbort: number[] = [];
    const autoCut: number[] = [];

    const expiring = [...this.inflightByTicket.entries()]
      .map(([ticket, key]) => ({ ticket, write: this.keys.get(key)!.inflight! }))
      .filter(({ write }) => now >= write.leaseDeadline)
      .sort((a, b) => a.ticket - b.ticket);
    for (const { ticket } of expiring) {
      const key = this.inflightByTicket.get(ticket);
      if (key === undefined) {
        continue;
      }
      const state = this.keys.get(key)!;
      const move = state.move;
      state.inflight = undefined;
      this.inflightByTicket.delete(ticket);
      expiredWrites.push(ticket);
      if (move && move.phase === "draining") {
        this.cut(move);
        autoCut.push(move.id);
      }
    }

    const dualExpired = [...this.moves.values()]
      .filter((move) => move.phase === "dual" && now >= move.dualDeadline)
      .sort((a, b) => a.id - b.id);
    for (const move of dualExpired) {
      if (move.caughtUp) {
        move.phase = "draining";
        move.drainDeadline = now + this.drainTimeoutMs;
        const state = this.keys.get(move.key)!;
        if (!state.inflight) {
          this.cut(move);
          autoCut.push(move.id);
        }
      } else {
        this.abort(move);
        forcedAbort.push(move.id);
      }
    }

    const draining = [...this.moves.values()]
      .filter((move) => move.phase === "draining")
      .sort((a, b) => a.id - b.id);
    for (const move of draining) {
      const state = this.keys.get(move.key)!;
      if (!state.inflight) {
        this.cut(move);
        autoCut.push(move.id);
      } else if (now >= move.drainDeadline!) {
        this.abort(move);
        forcedAbort.push(move.id);
      }
    }

    expiredWrites.sort((a, b) => a - b);
    forcedAbort.sort((a, b) => a - b);
    autoCut.sort((a, b) => a - b);
    return { expiredWrites, forcedAbort, autoCut };
  }

  moveStatus(moveId: number): MoveStatus {
    const move = this.moves.get(moveId);
    if (move) {
      return move.phase;
    }
    const finished = this.finishedMoves.get(moveId);
    if (finished) {
      return finished;
    }
    throw new InvalidMoveError(`unknown move: ${moveId}`);
  }

  activeMove(key: string): number | undefined {
    return this.keyState(key).move?.id;
  }

  shadowOf(key: string): string | undefined {
    return this.keyState(key).move?.shadow;
  }

  inflightTicket(key: string): number | undefined {
    return this.keyState(key).inflight?.ticket;
  }
}
