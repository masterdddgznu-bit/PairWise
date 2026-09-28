import { VirtualClock } from "./clock.js";
import { Mailbox } from "./mailbox.js";
import { CausalBuffer } from "./buffer.js";
import { RepairTimer } from "./repair.js";
import { StableGc } from "./gc.js";
import type {
  CausalMessage,
  Mail,
  Missing,
  RepairRequest,
  VecBufOpts,
} from "./types.js";

/**
 * Multi-node bus: unordered mailbox (base) + causal layer (feature).
 */
export class VecBuf {
  readonly n: number;
  readonly clock: VirtualClock;
  private readonly mail: Mailbox;
  private readonly repairTimeoutMs: number;
  private readonly cbuf: CausalBuffer;
  private readonly repair: RepairTimer;
  private readonly stableGc: StableGc;
  private pending: RepairRequest[] = [];

  constructor(n: number, clock?: VirtualClock, opts?: VecBufOpts) {
    if (n <= 0) throw new Error("n must be positive");
    this.n = n;
    this.clock = clock ?? new VirtualClock();
    this.mail = new Mailbox(n);
    this.repairTimeoutMs = opts?.repairTimeoutMs ?? 10;
    this.cbuf = new CausalBuffer(n);
    this.repair = new RepairTimer(n, this.clock, this.repairTimeoutMs);
    this.stableGc = new StableGc(n);
  }

  send(from: number, to: number, payload: string): void {
    this.mail.send(from, to, payload);
  }

  recv(to: number): Mail | null {
    return this.mail.recv(to);
  }

  inboxSize(to: number): number {
    return this.mail.size(to);
  }

  broadcast(from: number, payload: string): CausalMessage {
    return this.cbuf.bumpSend(from, payload);
  }

  receive(to: number, msg: CausalMessage): void {
    const wasEmpty = this.cbuf.buffered(to) === 0;
    this.cbuf.receive(to, msg);
    if (wasEmpty && this.cbuf.buffered(to) > 0) {
      this.repair.noteBufferNonEmpty(to);
    }
  }

  deliver(to: number): CausalMessage | null {
    const msg = this.cbuf.deliver(to);
    if (msg !== null && this.cbuf.buffered(to) === 0) {
      this.repair.noteBufferEmpty(to);
    }
    return msg;
  }

  deliverAll(to: number): CausalMessage[] {
    const out: CausalMessage[] = [];
    let msg: CausalMessage | null;
    while ((msg = this.deliver(to)) !== null) {
      out.push(msg);
    }
    return out;
  }

  buffered(to: number): number {
    return this.cbuf.buffered(to);
  }

  deliveredClock(to: number): number[] {
    return this.cbuf.deliveredClock(to);
  }

  missing(to: number): Missing[] {
    return this.cbuf.missing(to);
  }

  tick(): void {
    const requests = this.repair.tick((to) => this.cbuf.missing(to));
    this.pending.push(...requests);
  }

  pendingRepairs(): RepairRequest[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  ack(to: number, clock: number[]): void {
    this.stableGc.ack(to, clock);
  }

  minStableClock(): number[] {
    return this.stableGc.minStable(this.n);
  }

  gc(): void {
    const minStable = this.stableGc.minStable(this.n);
    for (let to = 0; to < this.n; to++) {
      const hadBuffered = this.cbuf.buffered(to) > 0;
      this.cbuf.gc(minStable, to);
      if (hadBuffered && this.cbuf.buffered(to) === 0) {
        this.repair.noteBufferEmpty(to);
      }
    }
  }

  protected timeout(): number {
    return this.repairTimeoutMs;
  }
}
