import { VirtualClock } from "./clock.js";
import { AProc } from "./process.js";
import { buildNeighbors, defaultEdges, isConnected } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";

export type AlphaSyncOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class AlphaSync {
  readonly clock: VirtualClock;
  private readonly procs: AProc[];
  private readonly neighbors: number[][];
  private msgSeq = 0;

  constructor(opts: AlphaSyncOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    AlphaSync.validateEdges(n, edges);
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("edges do not form a connected graph");
    }
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, i) => new AProc(i));
  }

  private static validateEdges(n: number, edges: number[][]): void {
    const seen = new Set<string>();
    for (const edge of edges) {
      if (!Array.isArray(edge) || edge.length !== 2) {
        throw new InvalidConfigError("each edge must be a [u, v] pair");
      }
      const [u, v] = edge;
      if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= n || v >= n) {
        throw new InvalidConfigError(`edge endpoint out of range: [${u}, ${v}]`);
      }
      if (u === v) {
        throw new InvalidConfigError(`self-loop not allowed: [${u}, ${v}]`);
      }
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      if (seen.has(key)) {
        throw new InvalidConfigError(`duplicate edge: [${u}, ${v}]`);
      }
      seen.add(key);
    }
  }

  private proc(id: number): AProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private onlineNeighbors(id: number): number[] {
    return this.neighbors[id].filter((nb) => this.procs[nb].online);
  }

  reset(): void {
    for (const p of this.procs) p.reset();
  }

  emit(id: number): number {
    const p = this.proc(id);
    if (!p.online) throw new OfflineError(id);
    if (p.emitted) throw new BusyError(`process ${id} already emitted pulse ${p.pulse}`);
    const targets = this.onlineNeighbors(id);
    for (const to of targets) {
      this.procs[to].inbox.push({
        kind: "PULSE",
        pulse: p.pulse,
        from: id,
        msgId: `m${this.msgSeq++}`,
      });
    }
    p.emitted = true;
    if (targets.length === 0) {
      p.pulse += 1;
      p.emitted = false;
      p.recv.clear();
    }
    return targets.length;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    if (msg.pulse === p.pulse) {
      p.recv.add(msg.from);
    }
    if (p.emitted && this.onlineNeighbors(id).every((nb) => p.recv.has(nb))) {
      p.pulse += 1;
      p.emitted = false;
      p.recv.clear();
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      const p = this.proc(to);
      if (!p.online) return;
      while (this.step(to)) { /* drain */ }
      return;
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of this.procs) {
        if (!p.online) continue;
        while (this.step(p.id)) progress = true;
      }
    }
  }

  pulseOf(id: number): number {
    return this.proc(id).pulse;
  }

  minPulse(): number {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return 0;
    return Math.min(...online.map((p) => p.pulse));
  }

  maxPulse(): number {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return 0;
    return Math.max(...online.map((p) => p.pulse));
  }

  barrier(targetPulse: number): number {
    if (!Number.isInteger(targetPulse) || targetPulse < 0) {
      throw new InvalidConfigError(`targetPulse must be a non-negative integer, got ${targetPulse}`);
    }
    while (this.minPulse() < targetPulse) {
      const before = this.minPulse();
      let emittedAny = false;
      for (const p of this.procs) {
        if (p.online && p.pulse < targetPulse && !p.emitted) {
          this.emit(p.id);
          emittedAny = true;
        }
      }
      this.pump();
      if (!emittedAny && this.minPulse() === before) break;
    }
    return this.minPulse();
  }

  synced(): boolean {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return true;
    const pulse = online[0].pulse;
    return online.every((p) => p.pulse === pulse && p.inbox.length === 0 && !p.emitted);
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
    if (this.procs.some((q) => q.online && q.emitted)) {
      throw new BusyError("cannot change online status while a pulse is in flight");
    }
    p.online = online;
  }

  isOnline(id: number): boolean {
    return this.proc(id).online;
  }
}
