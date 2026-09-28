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
  private readonly causal: CausalBuffer;
  private readonly repair: RepairTimer;
  private readonly stable: StableGc;

  constructor(n: number, clock?: VirtualClock, opts?: VecBufOpts) {
    if (n <= 0) throw new Error("n must be positive");
    this.n = n;
    this.clock = clock ?? new VirtualClock();
    this.mail = new Mailbox(n);
    this.repairTimeoutMs = opts?.repairTimeoutMs ?? 10;
    this.causal = new CausalBuffer(n);
    this.repair = new RepairTimer(n, this.clock, this.repairTimeoutMs);
    this.stable = new StableGc(n);
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
    return this.causal.bumpSend(from, payload);
  }

  receive(to: number, msg: CausalMessage): void {
    if (this.causal.receive(to, msg)) {
      this.repair.noteBufferNonEmpty(to);
    }
  }

  deliver(to: number): CausalMessage | null {
    const msg = this.causal.deliver(to);
    if (msg === null) return null;
    if (this.causal.isEmpty(to)) {
      this.repair.noteBufferEmpty(to);
    } else {
      this.repair.noteBufferNonEmpty(to);
    }
    return msg;
  }

  deliverAll(to: number): CausalMessage[] {
    const out: CausalMessage[] = [];
    for (;;) {
      const msg = this.deliver(to);
      if (msg === null) break;
      out.push(msg);
    }
    return out;
  }

  buffered(to: number): number {
    return this.causal.buffered(to);
  }

  deliveredClock(to: number): number[] {
    return this.causal.deliveredClock(to);
  }

  missing(to: number): Missing[] {
    return this.causal.missing(to);
  }

  tick(): void {
    this.repair.tick((to) => this.causal.missing(to));
  }

  pendingRepairs(): RepairRequest[] {
    return this.repair.drain();
  }

  ack(to: number, clock: number[]): void {
    this.stable.ack(to, clock);
  }

  minStableClock(): number[] {
    return this.stable.minStable();
  }

  gc(): void {
    const stable = this.stable.minStable();
    this.causal.gc(stable);
    for (let to = 0; to < this.n; to++) {
      if (this.causal.isEmpty(to)) {
        this.repair.noteBufferEmpty(to);
      }
    }
  }

  protected timeout(): number {
    return this.repairTimeoutMs;
  }
}
