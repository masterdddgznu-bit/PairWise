import { VirtualClock } from "./clock.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import { majority } from "./majority.js";
import { OProc } from "./process.js";
import { DEFAULT_ORDER, type OmMessage } from "./types.js";

export type OralMsgOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
  commanderId?: number;
};

export class OralMsg {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly f: number;
  private readonly commander: number;
  private readonly procs: OProc[];
  private started = false;
  private commanded = false;
  private commandValue: string | null = null;
  private msgCounter = 0;

  constructor(opts: OralMsgOptions) {
    this.clock = opts.clock;
    this.n = opts.processCount ?? 4;
    this.f = opts.faultBound ?? 1;
    this.commander = opts.commanderId ?? 0;
    if (!Number.isInteger(this.n) || this.n < 1) {
      throw new InvalidConfigError(`invalid processCount: ${this.n}`);
    }
    if (!Number.isInteger(this.f) || this.f < 0) {
      throw new InvalidConfigError(`invalid faultBound: ${this.f}`);
    }
    if (this.n < 3 * this.f + 1) {
      throw new InvalidConfigError(
        `processCount ${this.n} < 3*faultBound+1 (${3 * this.f + 1})`,
      );
    }
    if (
      !Number.isInteger(this.commander) ||
      this.commander < 0 ||
      this.commander >= this.n
    ) {
      throw new InvalidConfigError(`invalid commanderId: ${this.commander}`);
    }
    this.procs = Array.from({ length: this.n }, (_, id) => new OProc(id));
  }

  reset(): void {
    for (const p of this.procs) p.clear();
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
    if (this.commanded) throw new BusyError("already commanded");
    this.commanded = true;
    this.commandValue = value;
    const cmd = this.procs[this.commander];
    cmd.decided = true;
    cmd.decision = value;
    for (const p of this.procs) {
      if (p.id === this.commander) continue;
      p.inbox.push(this.makeMessage(this.f, [this.commander], value, this.commander));
    }
  }

  step(id: number): boolean {
    const proc = this.proc(id);
    const msg = proc.inbox.shift();
    if (!msg) return false;
    this.deliver(proc, msg);
    return true;
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of this.procs) {
        while (this.step(p.id)) progress = true;
      }
    }
    for (const p of this.procs) this.decide(p.id);
  }

  decide(id: number): void {
    const proc = this.proc(id);
    if (proc.id === this.commander) {
      if (this.commanded) {
        proc.decided = true;
        proc.decision = this.commandValue;
      }
      return;
    }
    const votes: string[] = [];
    votes.push(proc.lookup([this.commander]) ?? DEFAULT_ORDER);
    for (const p of this.procs) {
      if (p.id === this.commander || p.id === proc.id) continue;
      votes.push(proc.lookup([this.commander, p.id]) ?? DEFAULT_ORDER);
    }
    proc.decision = majority(votes);
    proc.decided = true;
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

  private deliver(recipient: OProc, msg: OmMessage): void {
    recipient.record(msg.path, msg.value);
    if (msg.depth <= 0) return;
    const path2 = msg.path.concat([recipient.id]);
    for (const p of this.procs) {
      if (path2.includes(p.id)) continue;
      p.inbox.push(this.makeMessage(msg.depth - 1, path2, msg.value, recipient.id));
    }
  }

  private makeMessage(
    depth: number,
    path: number[],
    value: string,
    from: number,
  ): OmMessage {
    return {
      kind: "OM",
      depth,
      path,
      value,
      from,
      msgId: `om-${this.msgCounter++}`,
    };
  }
}
