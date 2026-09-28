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
  private readonly procs: MProc[];
  private readonly sets: number[][];
  private msgCounter = 0;

  constructor(opts: MaekawaOptions) {
    this.clock = opts.clock;

    const n = opts.processCount ?? 3;
    if (!Number.isInteger(n) || n <= 0) {
      throw new InvalidConfigError(`invalid processCount: ${String(n)}`);
    }

    let sets: number[][];
    if (opts.votingSets !== undefined) {
      sets = opts.votingSets;
    } else if (n === 3) {
      sets = defaultVotingSets(3);
    } else {
      throw new InvalidConfigError(
        "votingSets are required when processCount is not 3",
      );
    }

    this.validateSets(n, sets);
    this.sets = sets.map((s) => [...new Set(s)]);
    this.procs = Array.from({ length: n }, (_, id) => new MProc(id));
  }

  private validateSets(n: number, sets: number[][]): void {
    if (!Array.isArray(sets) || sets.length !== n) {
      throw new InvalidConfigError(
        `votingSets must have ${n} entries, got ${sets?.length}`,
      );
    }
    for (let i = 0; i < n; i += 1) {
      const s = sets[i]!;
      if (!Array.isArray(s) || s.length === 0) {
        throw new InvalidConfigError(`voting set ${i} must be a non-empty array`);
      }
      if (!s.includes(i)) {
        throw new InvalidConfigError(
          `voting set ${i} must contain its own id ${i}`,
        );
      }
      for (const member of s) {
        if (!Number.isInteger(member) || member < 0 || member >= n) {
          throw new InvalidConfigError(
            `voting set ${i} references invalid process ${String(member)}`,
          );
        }
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
    this.msgCounter += 1;
    return String(this.msgCounter);
  }

  private proc(id: number): MProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id]!;
  }

  private requireOnline(id: number): MProc {
    const p = this.proc(id);
    if (!p.online) {
      throw new OfflineError(id);
    }
    return p;
  }

  request(id: number): string {
    const p = this.requireOnline(id);
    if (p.state !== "idle") {
      throw new BusyError(id);
    }
    p.lamport += 1;
    p.requestTs = p.lamport;
    p.state = "waiting";
    p.granted.clear();

    const msgId = this.nextMsgId();
    const msg: Message = {
      kind: "REQUEST",
      from: id,
      ts: p.requestTs,
      msgId,
    };
    for (const voter of this.sets[id]!) {
      this.procs[voter]!.inbox.push(msg);
    }
    return msgId;
  }

  release(id: number): string {
    const p = this.requireOnline(id);
    if (p.state !== "held") {
      throw new NotHolderError(id);
    }
    p.state = "idle";
    p.requestTs = null;
    p.granted.clear();

    const msgId = this.nextMsgId();
    const msg: Message = {
      kind: "RELEASE",
      from: id,
      ts: p.lamport,
      msgId,
    };
    for (const voter of this.sets[id]!) {
      this.procs[voter]!.inbox.push(msg);
    }
    return msgId;
  }

  step(id: number): boolean {
    const voter = this.requireOnline(id);
    const msg = voter.inbox.shift();
    if (msg === undefined) {
      return false;
    }
    if (msg.kind === "REQUEST") {
      this.handleRequest(voter, msg);
    } else if (msg.kind === "REPLY") {
      this.handleReply(voter, msg);
    } else {
      this.handleRelease(voter, msg);
    }
    return true;
  }

  private grant(voter: MProc, item: WaitItem, replyTs: number): void {
    voter.votingFor = item.from;
    const reply: Message = {
      kind: "REPLY",
      from: voter.id,
      ts: replyTs,
      msgId: this.nextMsgId(),
    };
    this.procs[item.from]!.inbox.push(reply);
  }

  private handleRequest(voter: MProc, msg: Message): void {
    if (voter.votingFor === null) {
      this.grant(voter, { from: msg.from, ts: msg.ts }, msg.ts);
      return;
    }
    if (voter.waitQ.some((w) => w.from === msg.from)) {
      return;
    }
    voter.waitQ.push({ from: msg.from, ts: msg.ts });
  }

  private handleReply(receiver: MProc, msg: Message): void {
    if (receiver.state !== "waiting") {
      return;
    }
    receiver.granted.add(msg.from);
    const own = this.sets[receiver.id]!;
    if (own.every((voter) => receiver.granted.has(voter))) {
      receiver.state = "held";
    }
  }

  private handleRelease(voter: MProc, msg: Message): void {
    if (voter.votingFor !== msg.from) {
      return;
    }
    voter.votingFor = null;
    if (voter.waitQ.length === 0) {
      return;
    }
    voter.waitQ.sort((a, b) => a.ts - b.ts || a.from - b.from);
    const next = voter.waitQ.shift()!;
    this.grant(voter, next, next.ts);
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
        // drain the target inbox
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const p of this.procs) {
        if (p.online && this.step(p.id)) {
          progressed = true;
        }
      }
    }
  }

  stateOf(id: number): ProcState {
    return this.proc(id).state;
  }

  holder(): number | null {
    for (const p of this.procs) {
      if (p.state === "held") {
        return p.id;
      }
    }
    return null;
  }

  repliesOf(id: number): number[] {
    return [...this.proc(id).granted].sort((a, b) => a - b);
  }

  votingFor(id: number): number | null {
    return this.proc(id).votingFor;
  }

  queuedAt(id: number): number[] {
    const q = [...this.proc(id).waitQ];
    q.sort((a, b) => a.ts - b.ts || a.from - b.from);
    return q.map((w) => w.from);
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  lamportOf(id: number): number {
    return this.proc(id).lamport;
  }

  votingSet(id: number): number[] {
    return [...this.sets[this.proc(id).id]!];
  }

  setOnline(id: number, online: boolean): void {
    this.proc(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.proc(id).online;
  }
}
