import { VirtualClock } from "./clock.js";
import { GapBuffer } from "./buffer.js";
import { canDeliver, applyDeliver } from "./deliver.js";
import {
  InvalidConfigError,
  InvalidMessageError,
  InvalidStateError,
} from "./errors.js";
import type {
  CausBufOptions,
  Message,
  ReceiveResult,
  VectorClock,
} from "./types.js";
import { zero, copy, bumpSelf } from "./vclock.js";

const DEFAULT_CAPACITY = 64;

function deliveredKey(sender: string, seq: number): string {
  return `${sender}#${seq}`;
}

type Snapshot = {
  procTime: number;
  nodes: string[];
  self: string;
  capacity: number;
  vc: VectorClock;
  buffer: Message[];
  delivered: string[];
  outbox: Message[];
  lastDropped: Message | null;
};

export class CausBuf {
  readonly procClock: VirtualClock;
  private readonly nodes: string[];
  private readonly self: string;
  private readonly capacity: number;
  private vc: VectorClock;
  private readonly buffer = new GapBuffer();
  private readonly delivered = new Set<string>();
  private outbox: Message[] = [];
  private dropped: Message | undefined;

  constructor(opts: CausBufOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    if (
      !Array.isArray(opts.nodes) ||
      opts.nodes.length === 0 ||
      opts.nodes.some((n) => typeof n !== "string" || n.length === 0)
    ) {
      throw new InvalidConfigError("nodes must be a non-empty string array");
    }
    if (new Set(opts.nodes).size !== opts.nodes.length) {
      throw new InvalidConfigError("nodes must be unique");
    }
    if (!opts.nodes.includes(opts.self)) {
      throw new InvalidConfigError("self must be a member of nodes");
    }
    const capacity = opts.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new InvalidConfigError("capacity must be an integer >= 1");
    }
    this.procClock = opts.clock;
    this.nodes = [...opts.nodes].sort();
    this.self = opts.self;
    this.capacity = capacity;
    this.vc = zero(this.nodes);
  }

  send(payload: string): Message {
    bumpSelf(this.vc, this.self);
    const vc = copy(this.vc);
    return { sender: this.self, vc, payload, seq: vc[this.self] };
  }

  receive(m: Message): ReceiveResult {
    this.validateMessage(m);
    if (m.sender === this.self) return "ignored";
    if (
      this.delivered.has(deliveredKey(m.sender, m.seq)) ||
      this.buffer.has(m.sender, m.seq) ||
      m.vc[m.sender] <= this.vc[m.sender]
    ) {
      return "duplicate";
    }
    if (this.buffer.size() >= this.capacity) {
      const victim = this.buffer.pickVictim();
      if (victim !== undefined) {
        this.buffer.remove(victim.sender, victim.seq);
        this.dropped = victim;
      }
    }
    this.buffer.add(m);
    const deliveredAny = this.drain();
    return deliveredAny ? "delivered" : "buffered";
  }

  private validateMessage(m: Message): void {
    if (m === null || typeof m !== "object") {
      throw new InvalidMessageError("message must be an object");
    }
    if (!this.nodes.includes(m.sender)) {
      throw new InvalidMessageError(`unknown sender: ${String(m.sender)}`);
    }
    if (m.vc === null || typeof m.vc !== "object") {
      throw new InvalidMessageError("vc must be an object");
    }
    for (const n of this.nodes) {
      if (!(n in m.vc)) {
        throw new InvalidMessageError(`vc missing key: ${n}`);
      }
      if (typeof m.vc[n] !== "number" || !Number.isFinite(m.vc[n])) {
        throw new InvalidMessageError(`vc component not finite: ${n}`);
      }
    }
    if (typeof m.seq !== "number" || !Number.isFinite(m.seq)) {
      throw new InvalidMessageError("seq must be finite");
    }
  }

  private drain(): boolean {
    let any = false;
    for (;;) {
      const ready = this.buffer
        .list()
        .filter((m) => canDeliver(m, this.vc))
        .sort((x, y) =>
          x.sender === y.sender ? x.seq - y.seq : x.sender < y.sender ? -1 : 1,
        );
      if (ready.length === 0) return any;
      for (const m of ready) {
        this.buffer.remove(m.sender, m.seq);
        applyDeliver(this.vc, m);
        this.delivered.add(deliveredKey(m.sender, m.seq));
        this.outbox.push(m);
        any = true;
      }
    }
  }

  poll(): Message[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  clock(): VectorClock {
    return copy(this.vc);
  }

  pending(): number {
    return this.buffer.size();
  }

  lastDropped(): Message | undefined {
    return this.dropped;
  }

  exportState(): string {
    const snap: Snapshot = {
      procTime: this.procClock.now(),
      nodes: this.nodes,
      self: this.self,
      capacity: this.capacity,
      vc: copy(this.vc),
      buffer: this.buffer.list(),
      delivered: [...this.delivered],
      outbox: this.outbox,
      lastDropped: this.dropped ?? null,
    };
    return JSON.stringify(snap);
  }

  importState(json: string): void {
    let snap: Snapshot;
    try {
      snap = JSON.parse(json) as Snapshot;
    } catch {
      throw new InvalidStateError("invalid JSON");
    }
    if (snap === null || typeof snap !== "object") {
      throw new InvalidStateError("state must be an object");
    }
    if (
      snap.vc === null ||
      typeof snap.vc !== "object" ||
      !Array.isArray(snap.buffer) ||
      !Array.isArray(snap.delivered) ||
      !Array.isArray(snap.outbox)
    ) {
      throw new InvalidStateError("malformed state");
    }
    const vc = zero(this.nodes);
    for (const n of this.nodes) {
      const v = snap.vc[n];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new InvalidStateError(`bad vc component: ${n}`);
      }
      vc[n] = v;
    }
    this.vc = vc;
    for (const m of this.buffer.list()) this.buffer.remove(m.sender, m.seq);
    for (const m of snap.buffer) this.buffer.add(m);
    this.delivered.clear();
    for (const k of snap.delivered) this.delivered.add(k);
    this.outbox = [...snap.outbox];
    this.dropped = snap.lastDropped ?? undefined;
  }
}
