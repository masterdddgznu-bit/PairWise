import { VirtualClock } from "./clock.js";
import { OProc } from "./process.js";
import { majority } from "./majority.js";
import { DEFAULT_ORDER, type OmMessage } from "./types.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";

export type OralMsgOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
  commanderId?: number;
};

function keyOf(path: number[]): string {
  return path.join(",");
}

export class OralMsg {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly f: number;
  private readonly commander: number;
  private procs: OProc[] = [];
  private started = false;
  private commanded = false;
  private commandValue: string | null = null;
  private msgCounter = 0;

  constructor(opts: OralMsgOptions) {
    this.clock = opts.clock;
    this.n = opts.processCount ?? 4;
    this.f = opts.faultBound ?? 1;
    this.commander = opts.commanderId ?? 0;
    if (!Number.isInteger(this.f) || this.f < 0) {
      throw new InvalidConfigError(`faultBound must be a non-negative integer: ${this.f}`);
    }
    if (!Number.isInteger(this.n) || this.n < 3 * this.f + 1) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 3*faultBound+1: ${this.n}`,
      );
    }
    if (
      !Number.isInteger(this.commander) ||
      this.commander < 0 ||
      this.commander >= this.n
    ) {
      throw new InvalidConfigError(`invalid commanderId: ${this.commander}`);
    }
    this.reset();
  }

  reset(): void {
    this.procs = Array.from({ length: this.n }, (_, id) => new OProc(id));
    this.started = false;
    this.commanded = false;
    this.commandValue = null;
    this.msgCounter = 0;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.reset();
    this.started = true;
  }

  command(value: string): void {
    if (!this.started) throw new BusyError("not started");
    if (this.commanded) throw new BusyError("command already issued");
    this.commanded = true;
    this.commandValue = value;
    const cmdr = this.procs[this.commander];
    cmdr.decided = true;
    cmdr.decision = value;
    for (const p of this.procs) {
      if (p.id === this.commander) continue;
      p.inbox.push(this.makeMessage(this.f, [this.commander], value, this.commander));
    }
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (!msg) return false;
    this.deliver(p, msg);
    return true;
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of this.procs) {
        while (p.inbox.length > 0) {
          this.step(p.id);
          progress = true;
        }
      }
    }
    if (this.started && this.commanded) {
      for (const p of this.procs) {
        if (!p.decided) this.decide(p.id);
      }
    }
  }

  decided(id: number): boolean {
    return this.proc(id).decided;
  }

  decision(id: number): string | null {
    return this.proc(id).decision;
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  commanderId(): number {
    return this.commander;
  }

  faultBound(): number {
    return this.f;
  }

  processCount(): number {
    return this.n;
  }

  private proc(id: number): OProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private makeMessage(
    depth: number,
    path: number[],
    value: string,
    from: number,
  ): OmMessage {
    this.msgCounter += 1;
    return {
      kind: "OM",
      depth,
      path,
      value,
      from,
      msgId: `${this.clock.now()}-${this.msgCounter}`,
    };
  }

  private deliver(recipient: OProc, msg: OmMessage): void {
    const key = keyOf(msg.path);
    if (!recipient.collected.has(key)) {
      recipient.collected.set(key, msg.value);
    }
    if (msg.depth > 0) {
      const path2 = msg.path.concat([recipient.id]);
      for (const p of this.procs) {
        if (path2.includes(p.id)) continue;
        p.inbox.push(this.makeMessage(msg.depth - 1, path2, msg.value, recipient.id));
      }
    }
  }

  private decide(id: number): void {
    const p = this.procs[id];
    if (id === this.commander) {
      p.decided = true;
      p.decision = this.commandValue;
      return;
    }
    const votes: string[] = [];
    votes.push(p.collected.get(keyOf([this.commander])) ?? DEFAULT_ORDER);
    for (const other of this.procs) {
      if (other.id === this.commander || other.id === id) continue;
      votes.push(
        p.collected.get(keyOf([this.commander, other.id])) ?? DEFAULT_ORDER,
      );
    }
    p.decided = true;
    p.decision = majority(votes);
  }
}
