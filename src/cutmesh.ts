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

export interface WriteLease {
  ticket: number;
  fence: number;
}

export interface DriveReport {
  expiredWrites: number[];
  forcedAbort: number[];
  autoCut: number[];
}

type MoveStatus = "dual" | "draining" | "cut" | "aborted";

interface InflightWrite {
  ticket: number;
  fence: number;
  shard: string;
  leaseDeadline: number;
}

interface MoveState {
  id: number;
  key: string;
  from: string;
  to: string;
  shadow: string;
  status: MoveStatus;
  caughtUp: boolean;
  startedAt: number;
  dualDeadline: number;
  drainDeadline?: number;
}

interface KeyState {
  owner: string;
  gen: number;
  value: string;
  inflight?: InflightWrite;
  moveId?: number;
}

export class CutMesh {
  private readonly clock: VirtualClock;
  private readonly shards: string[];
  private readonly dualWriteMs: number;
  private readonly drainTimeoutMs: number;
  private readonly leaseMs: number;

  private readonly keys = new Map<string, KeyState>();
  private readonly moves = new Map<number, MoveState>();
  private nextTicket = 1;
  private nextFence = 1;
  private nextMoveId = 1;

  constructor(config: CutMeshConfig) {
    const { clock, shards, dualWriteMs, drainTimeoutMs, leaseMs } = config;
    if (
      !Array.isArray(shards) ||
      shards.length === 0 ||
      new Set(shards).size !== shards.length ||
      shards.some((s) => typeof s !== "string" || s.length === 0)
    ) {
      throw new InvalidConfigError(
        "shards must be a non-empty array of unique names",
      );
    }
    if (!(dualWriteMs >= 1) || !(drainTimeoutMs >= 1) || !(leaseMs >= 1)) {
      throw new InvalidConfigError(
        "dualWriteMs, drainTimeoutMs and leaseMs must be >= 1",
      );
    }
    this.clock = clock;
    this.shards = [...shards].sort();
    this.dualWriteMs = dualWriteMs;
    this.drainTimeoutMs = drainTimeoutMs;
    this.leaseMs = leaseMs;
  }

  place(key: string, value: string, shard: string): void {
    if (!this.shards.includes(shard)) {
      throw new UnknownShardError(`unknown shard: ${shard}`);
    }
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

  beginWrite(key: string, shard: string, gen: number): WriteLease {
    const state = this.keyState(key);
    if (gen !== state.gen) {
      throw new FenceError(`stale gen ${gen}, current gen is ${state.gen}`);
    }
    const move = this.activeMoveOf(state);
    if (move !== undefined && move.status === "draining") {
      throw new InvalidMoveError(`key ${key} is draining; no new writes`);
    }
    const allowed =
      move !== undefined && move.status === "dual"
        ? [move.from, move.to]
        : [state.owner];
    if (!allowed.includes(shard)) {
      throw new NotOwnerError(`shard ${shard} may not write key ${key}`);
    }
    if (state.inflight !== undefined) {
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
    return { ticket, fence };
  }

  endWrite(ticket: number, fence: number, value: string): boolean {
    const { state, inflight } = this.matchInflight(ticket, fence);
    const move = this.activeMoveOf(state);
    if (
      move !== undefined &&
      (move.status === "dual" || move.status === "draining")
    ) {
      if (inflight.shard === move.from) {
        state.value = value;
        move.shadow = value;
      } else if (inflight.shard === move.to) {
        move.shadow = value;
      } else {
        state.value = value;
      }
    } else {
      state.value = value;
    }
    state.inflight = undefined;
    this.maybeAutoCut(state);
    return true;
  }

  cancelWrite(ticket: number, fence: number): boolean {
    const { state } = this.matchInflight(ticket, fence);
    state.inflight = undefined;
    this.maybeAutoCut(state);
    return true;
  }

  beginMove(key: string, toShard: string): number {
    const state = this.keyState(key);
    if (!this.shards.includes(toShard)) {
      throw new UnknownShardError(`unknown shard: ${toShard}`);
    }
    if (toShard === state.owner) {
      throw new InvalidMoveError(`key ${key} is already owned by ${toShard}`);
    }
    if (state.moveId !== undefined) {
      throw new InvalidMoveError(`key ${key} already has an active move`);
    }
    if (state.inflight !== undefined) {
      throw new InFlightError(`key ${key} has an inflight write`);
    }
    const id = this.nextMoveId++;
    const now = this.clock.now();
    this.moves.set(id, {
      id,
      key,
      from: state.owner,
      to: toShard,
      shadow: state.value,
      status: "dual",
      caughtUp: false,
      startedAt: now,
      dualDeadline: now + this.dualWriteMs,
    });
    state.moveId = id;
    return id;
  }

  ackCatchup(moveId: number, shard: string): boolean {
    const move = this.moveState(moveId);
    if (move.status !== "dual" || shard !== move.to) {
      return false;
    }
    move.caughtUp = true;
    return true;
  }

  requestCut(moveId: number): boolean {
    const move = this.moveState(moveId);
    if (move.status !== "dual" || !move.caughtUp) {
      return false;
    }
    const state = this.keyState(move.key);
    if (state.inflight !== undefined) {
      throw new InFlightError(`key ${move.key} has an inflight write`);
    }
    this.enterDraining(move);
    this.maybeAutoCut(state);
    return true;
  }

  requestAbort(moveId: number): boolean {
    const move = this.moveState(moveId);
    if (move.status !== "dual" && move.status !== "draining") {
      return false;
    }
    this.abortMove(move);
    return true;
  }

  cutover(moveId: number): boolean {
    const move = this.moveState(moveId);
    if (move.status !== "draining") {
      return false;
    }
    const state = this.keyState(move.key);
    if (state.inflight !== undefined) {
      throw new InFlightError(`key ${move.key} has an inflight write`);
    }
    this.cutMove(move, state);
    return true;
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const expiredWrites: number[] = [];
    const forcedAbort: number[] = [];
    const autoCut: number[] = [];

    const expiring: Array<{ state: KeyState; inflight: InflightWrite }> = [];
    for (const state of this.keys.values()) {
      if (state.inflight !== undefined && now >= state.inflight.leaseDeadline) {
        expiring.push({ state, inflight: state.inflight });
      }
    }
    expiring.sort((a, b) => a.inflight.ticket - b.inflight.ticket);
    for (const { state, inflight } of expiring) {
      if (state.inflight?.ticket !== inflight.ticket) {
        continue;
      }
      state.inflight = undefined;
      expiredWrites.push(inflight.ticket);
      const moveId = state.moveId;
      if (moveId !== undefined && this.maybeAutoCut(state)) {
        autoCut.push(moveId);
      }
    }

    const duals = [...this.moves.values()]
      .filter((mv) => mv.status === "dual" && now >= mv.dualDeadline)
      .sort((a, b) => a.id - b.id);
    for (const move of duals) {
      const state = this.keyState(move.key);
      if (move.caughtUp) {
        this.enterDraining(move);
        if (this.maybeAutoCut(state)) {
          autoCut.push(move.id);
        }
      } else {
        this.abortMove(move);
        forcedAbort.push(move.id);
      }
    }

    const drainings = [...this.moves.values()]
      .filter((mv) => mv.status === "draining")
      .sort((a, b) => a.id - b.id);
    for (const move of drainings) {
      const state = this.keyState(move.key);
      if (state.inflight === undefined) {
        this.cutMove(move, state);
        autoCut.push(move.id);
      } else if (move.drainDeadline !== undefined && now >= move.drainDeadline) {
        this.abortMove(move);
        forcedAbort.push(move.id);
      }
    }

    expiredWrites.sort((a, b) => a - b);
    forcedAbort.sort((a, b) => a - b);
    autoCut.sort((a, b) => a - b);
    return { expiredWrites, forcedAbort, autoCut };
  }

  moveStatus(moveId: number): MoveStatus {
    return this.moveState(moveId).status;
  }

  activeMove(key: string): number | undefined {
    return this.keyState(key).moveId;
  }

  shadowOf(key: string): string | undefined {
    const state = this.keyState(key);
    const move = this.activeMoveOf(state);
    if (move === undefined) {
      return undefined;
    }
    return move.shadow;
  }

  inflightTicket(key: string): number | undefined {
    return this.keyState(key).inflight?.ticket;
  }

  private keyState(key: string): KeyState {
    const state = this.keys.get(key);
    if (state === undefined) {
      throw new UnknownKeyError(`unknown key: ${key}`);
    }
    return state;
  }

  private moveState(moveId: number): MoveState {
    const move = this.moves.get(moveId);
    if (move === undefined) {
      throw new InvalidMoveError(`unknown move: ${moveId}`);
    }
    return move;
  }

  private activeMoveOf(state: KeyState): MoveState | undefined {
    if (state.moveId === undefined) {
      return undefined;
    }
    return this.moves.get(state.moveId);
  }

  private matchInflight(
    ticket: number,
    fence: number,
  ): { state: KeyState; inflight: InflightWrite } {
    for (const state of this.keys.values()) {
      if (state.inflight !== undefined && state.inflight.ticket === ticket) {
        if (state.inflight.fence !== fence) {
          throw new FenceError(`fence mismatch for ticket ${ticket}`);
        }
        return { state, inflight: state.inflight };
      }
    }
    throw new UnknownTicketError(`unknown ticket: ${ticket}`);
  }

  private enterDraining(move: MoveState): void {
    move.status = "draining";
    move.drainDeadline = this.clock.now() + this.drainTimeoutMs;
  }

  private cutMove(move: MoveState, state: KeyState): void {
    state.owner = move.to;
    state.gen += 1;
    state.value = move.shadow;
    state.moveId = undefined;
    move.status = "cut";
  }

  private abortMove(move: MoveState): void {
    const state = this.keyState(move.key);
    state.moveId = undefined;
    move.status = "aborted";
  }

  private maybeAutoCut(state: KeyState): boolean {
    if (state.moveId === undefined || state.inflight !== undefined) {
      return false;
    }
    const move = this.moves.get(state.moveId);
    if (move === undefined || move.status !== "draining") {
      return false;
    }
    this.cutMove(move, state);
    return true;
  }
}
