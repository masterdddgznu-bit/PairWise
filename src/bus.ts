import { VirtualClock } from "./clock.js";
import { Mailbox } from "./mailbox.js";
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

  constructor(n: number, clock?: VirtualClock, opts?: VecBufOpts) {
    if (n <= 0) throw new Error("n must be positive");
    this.n = n;
    this.clock = clock ?? new VirtualClock();
    this.mail = new Mailbox(n);
    this.repairTimeoutMs = opts?.repairTimeoutMs ?? 10;
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

  broadcast(_from: number, _payload: string): CausalMessage {
    throw new Error("broadcast not implemented");
  }

  receive(_to: number, _msg: CausalMessage): void {
    throw new Error("receive not implemented");
  }

  deliver(_to: number): CausalMessage | null {
    throw new Error("deliver not implemented");
  }

  deliverAll(_to: number): CausalMessage[] {
    throw new Error("deliverAll not implemented");
  }

  buffered(_to: number): number {
    throw new Error("buffered not implemented");
  }

  deliveredClock(_to: number): number[] {
    throw new Error("deliveredClock not implemented");
  }

  missing(_to: number): Missing[] {
    throw new Error("missing not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }

  pendingRepairs(): RepairRequest[] {
    throw new Error("pendingRepairs not implemented");
  }

  ack(_to: number, _clock: number[]): void {
    throw new Error("ack not implemented");
  }

  minStableClock(): number[] {
    throw new Error("minStableClock not implemented");
  }

  gc(): void {
    throw new Error("gc not implemented");
  }

  protected timeout(): number {
    return this.repairTimeoutMs;
  }
}
