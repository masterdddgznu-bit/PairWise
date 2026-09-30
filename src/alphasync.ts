import { VirtualClock } from "./clock.js";
import { AProc } from "./process.js";
import { defaultEdges, buildNeighbors, isConnected } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import type { Message } from "./types.js";

export type AlphaSyncOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

function validateEdges(n: number, edges: number[][]): void {
  const seen = new Set<string>();
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 2) {
      throw new InvalidConfigError(`invalid edge: ${JSON.stringify(e)}`);
    }
    const [u, v] = e;
    if (
      !Number.isInteger(u) ||
      !Number.isInteger(v) ||
      u < 0 ||
      v < 0 ||
      u >= n ||
      v >= n
    ) {
      throw new InvalidConfigError(`edge endpoint out of range: [${u}, ${v}]`);
    }
    if (u === v) {
      throw new InvalidConfigError(`self loop not allowed: [${u}, ${v}]`);
    }
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (seen.has(key)) {
      throw new InvalidConfigError(`duplicate edge: [${u}, ${v}]`);
    }
    seen.add(key);
  }
  if (!isConnected(n, edges)) {
    throw new InvalidConfigError("edges do not form a connected graph");
  }
}

export class AlphaSync {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly neighbors: number[][];
  private readonly procs: AProc[];
  private msgSeq = 0;

  constructor(opts: AlphaSyncOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    validateEdges(n, edges);
    this.n = n;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, i) => new AProc(i));
  }

  private proc(id: number): AProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private maybeAdvance(p: AProc): void {
    if (!p.emitted) return;
    for (const nb of this.neighbors[p.id]) {
      if (this.procs[nb].online && !p.recv.has(nb)) return;
    }
    p.pulse += 1;
    p.emitted = false;
    p.recv.clear();
  }

  reset(): void {
    for (const p of this.procs) p.reset();
  }

  emit(id: number): number {
    const p = this.proc(id);
    if (!p.online) throw new OfflineError(id);
    if (p.emitted) {
      throw new BusyError(`process ${id} already emitted pulse ${p.pulse}`);
    }
    let sent = 0;
    for (const nb of this.neighbors[id]) {
      if (!this.procs[nb].online) continue;
      const msg: Message = {
        kind: "PULSE",
        pulse: p.pulse,
        from: id,
        msgId: `${id}:${p.pulse}:${this.msgSeq++}`,
      };
      this.procs[nb].inbox.push(msg);
      sent++;
    }
    p.emitted = true;
    this.maybeAdvance(p);
    return sent;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    if (msg.pulse === p.pulse) {
      p.recv.add(msg.from);
      this.maybeAdvance(p);
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      const p = this.proc(to);
      if (!p.online) return;
      while (this.step(to)) {
        // drain
      }
      return;
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of this.procs) {
        if (!p.online) continue;
        if (this.step(p.id)) progress = true;
      }
    }
  }

  pulseOf(id: number): number {
    return this.proc(id).pulse;
  }

  minPulse(): number {
    let min: number | undefined;
    for (const p of this.procs) {
      if (!p.online) continue;
      if (min === undefined || p.pulse < min) min = p.pulse;
    }
    return min ?? 0;
  }

  maxPulse(): number {
    let max: number | undefined;
    for (const p of this.procs) {
      if (!p.online) continue;
      if (max === undefined || p.pulse > max) max = p.pulse;
    }
    return max ?? 0;
  }

  barrier(targetPulse: number): number {
    if (!Number.isInteger(targetPulse) || targetPulse < 0) {
      throw new InvalidConfigError(`targetPulse must be a non-negative integer, got ${targetPulse}`);
    }
    while (this.minPulse() < targetPulse) {
      let acted = false;
      for (const p of this.procs) {
        if (p.online && p.pulse < targetPulse && !p.emitted) {
          this.emit(p.id);
          acted = true;
        }
      }
      const pending = this.procs.some((p) => p.online && p.inbox.length > 0);
      this.pump();
      if (!acted && !pending) break;
    }
    return this.minPulse();
  }

  synced(): boolean {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return true;
    const pulse = online[0].pulse;
    return online.every(
      (p) => p.pulse === pulse && !p.emitted && p.inbox.length === 0,
    );
  }

  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    const p = this.proc(id);
    if (this.procs.some((q) => q.emitted)) {
      throw new BusyError("cannot change online status while a pulse is in flight");
    }
    p.online = online;
  }

  isOnline(id: number): boolean {
    return this.proc(id).online;
  }
}
