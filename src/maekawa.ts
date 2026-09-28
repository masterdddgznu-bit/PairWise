import { VirtualClock } from "./clock.js";
import { MProc } from "./process.js";
import type { Message, ProcState, WaitItem } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  NotHolderError,
  OfflineError,
} from "./errors.js";
import { defaultVotingSets, intersect } from "./quorums.js";

export type MaekawaOptions = {
  clock: VirtualClock;
  processCount?: number;
  votingSets?: number[][];
};

export class Maekawa {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private readonly votingSets: number[][];
  private readonly procs: MProc[];
  private msgSeq = 0;

  constructor(opts: MaekawaOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 3;
    if (!Number.isInteger(n) || n < 1) {
      throw new InvalidConfigError(`invalid processCount: ${n}`);
    }
    this.processCount = n;

    const sets = opts.votingSets ?? defaultVotingSets(n);
    this.validateVotingSets(sets, n);
    this.votingSets = sets.map((row) => [...row]);

    this.procs = Array.from({ length: n }, (_, id) => new MProc(id));
  }

  private validateVotingSets(sets: number[][], n: number): void {
    if (!Array.isArray(sets) || sets.length !== n) {
      throw new InvalidConfigError("votingSets must have length processCount");
    }
    for (let i = 0; i < n; i += 1) {
      const row = sets[i]!;
      if (!Array.isArray(row) || !row.includes(i)) {
        throw new InvalidConfigError(
          `voting set of process ${i} must contain its own id`,
        );
      }
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (!intersect(sets[i]!, sets[j]!)) {
          throw new InvalidConfigError(
            `voting sets ${i} and ${j} must intersect`,
          );
        }
      }
    }
  }

  private nextMsgId(): string {
    this.msgSeq += 1;
    return String(this.msgSeq);
  }

  private requireValid(id: number): MProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id]!;
  }

  private requireOnline(id: number): MProc {
    const proc = this.requireValid(id);
    if (!proc.online) {
      throw new OfflineError(id);
    }
    return proc;
  }

  private setOf(id: number): number[] {
    return this.votingSets[id]!;
  }

  private enqueue(to: number, msg: Message): void {
    this.procs[to]!.inbox.push(msg);
  }

  request(id: number): string {
    const proc = this.requireOnline(id);
    if (proc.state !== "idle") {
      throw new BusyError(id);
    }
    proc.lamport += 1;
    const requestTs = proc.lamport;
    proc.state = "waiting";
    proc.requestTs = requestTs;
    proc.granted.clear();

    const msgId = this.nextMsgId();
    for (const voter of this.setOf(id)) {
      this.enqueue(voter, { kind: "REQUEST", from: id, ts: requestTs, msgId });
    }
    return msgId;
  }

  release(id: number): string {
    const proc = this.requireValid(id);
    if (proc.state !== "held") {
      throw new NotHolderError(id);
    }
    if (!proc.online) {
      throw new OfflineError(id);
    }
    proc.state = "idle";
    proc.requestTs = null;
    proc.granted.clear();

    const msgId = this.nextMsgId();
    for (const voter of this.setOf(id)) {
      this.enqueue(voter, {
        kind: "RELEASE",
        from: id,
        ts: proc.lamport,
        msgId,
      });
    }
    return msgId;
  }

  step(id: number): boolean {
    const proc = this.requireOnline(id);
    const msg = proc.inbox.shift();
    if (msg === undefined) {
      return false;
    }

    if (msg.kind === "REQUEST") {
      if (proc.votingFor === null) {
        proc.votingFor = msg.from;
        this.enqueue(msg.from, {
          kind: "REPLY",
          from: id,
          ts: msg.ts,
          msgId: this.nextMsgId(),
        });
      } else if (!proc.waitQ.some((item) => item.from === msg.from)) {
        proc.waitQ.push({ from: msg.from, ts: msg.ts });
      }
      return true;
    }

    if (msg.kind === "REPLY") {
      if (proc.state === "waiting") {
        proc.granted.add(msg.from);
        const quorum = this.setOf(id);
        if (quorum.every((voter) => proc.granted.has(voter))) {
          proc.state = "held";
        }
      }
      return true;
    }

    // msg.kind === "RELEASE"
    if (proc.votingFor === msg.from) {
      proc.votingFor = null;
      let next: WaitItem | null = null;
      for (const item of proc.waitQ) {
        if (
          next === null ||
          item.ts < next.ts ||
          (item.ts === next.ts && item.from < next.from)
        ) {
          next = item;
        }
      }
      if (next !== null) {
        proc.waitQ = proc.waitQ.filter((item) => item !== next);
        proc.votingFor = next.from;
        this.enqueue(next.from, {
          kind: "REPLY",
          from: id,
          ts: next.ts,
          msgId: this.nextMsgId(),
        });
      }
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
        // drain
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const proc of this.procs) {
        if (proc.online && proc.inbox.length > 0) {
          progressed = true;
          this.step(proc.id);
        }
      }
    }
  }

  stateOf(id: number): ProcState {
    return this.requireValid(id).state;
  }

  holder(): number | null {
    const found = this.procs.find((proc) => proc.state === "held");
    return found ? found.id : null;
  }

  repliesOf(id: number): number[] {
    const proc = this.requireValid(id);
    return [...proc.granted].sort((a, b) => a - b);
  }

  votingFor(id: number): number | null {
    return this.requireValid(id).votingFor;
  }

  queuedAt(id: number): number[] {
    const proc = this.requireValid(id);
    return [...proc.waitQ]
      .sort((a, b) => a.ts - b.ts || a.from - b.from)
      .map((item) => item.from);
  }

  inboxSize(id: number): number {
    return this.requireValid(id).inbox.length;
  }

  lamportOf(id: number): number {
    return this.requireValid(id).lamport;
  }

  votingSet(id: number): number[] {
    this.requireValid(id);
    return [...this.setOf(id)];
  }

  setOnline(id: number, online: boolean): void {
    this.requireValid(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.requireValid(id).online;
  }
}
