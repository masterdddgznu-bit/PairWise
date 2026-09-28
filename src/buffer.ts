import type { CausalMessage, Missing } from "./types.js";
import { copy, dominates, vmax, zeros } from "./vclock.js";

function keyOf(from: number, seq: number): string {
  return `${from}:${seq}`;
}

function copyMsg(msg: CausalMessage): CausalMessage {
  return { from: msg.from, seq: msg.seq, payload: msg.payload, vc: copy(msg.vc) };
}

export class CausalBuffer {
  private readonly n: number;
  private readonly delivered: number[][];
  private readonly localVcs: number[][];
  private readonly sendSeqs: number[];
  private readonly buffers: Map<string, CausalMessage>[];
  private readonly seen: Set<string>[];

  constructor(n: number) {
    this.n = n;
    this.delivered = Array.from({ length: n }, () => zeros(n));
    this.localVcs = Array.from({ length: n }, () => zeros(n));
    this.sendSeqs = Array.from({ length: n }, () => 0);
    this.buffers = Array.from({ length: n }, () => new Map());
    this.seen = Array.from({ length: n }, () => new Set());
  }

  receive(to: number, msg: CausalMessage): void {
    if (msg.seq <= this.delivered[to][msg.from]) return;
    const key = keyOf(msg.from, msg.seq);
    if (this.seen[to].has(key)) return;
    this.seen[to].add(key);
    this.buffers[to].set(key, copyMsg(msg));
  }

  private deliverable(to: number, msg: CausalMessage): boolean {
    const del = this.delivered[to];
    if (msg.vc[msg.from] !== del[msg.from] + 1) return false;
    for (let k = 0; k < this.n; k++) {
      if (k !== msg.from && msg.vc[k] > del[k]) return false;
    }
    return true;
  }

  deliver(to: number): CausalMessage | null {
    let best: CausalMessage | null = null;
    for (const msg of this.buffers[to].values()) {
      if (!this.deliverable(to, msg)) continue;
      if (
        best === null ||
        msg.from < best.from ||
        (msg.from === best.from && msg.seq < best.seq)
      ) {
        best = msg;
      }
    }
    if (best === null) return null;
    this.buffers[to].delete(keyOf(best.from, best.seq));
    this.delivered[to][best.from] += 1;
    this.localVcs[to] = vmax(this.localVcs[to], best.vc);
    return copyMsg(best);
  }

  buffered(to: number): number {
    return this.buffers[to].size;
  }

  deliveredClock(to: number): number[] {
    return copy(this.delivered[to]);
  }

  missing(to: number): Missing[] {
    const out: Missing[] = [];
    for (let f = 0; f < this.n; f++) {
      if (f === to) continue;
      const expect = this.delivered[to][f] + 1;
      let minBuffered = Infinity;
      for (const msg of this.buffers[to].values()) {
        if (msg.from === f && msg.seq > expect && msg.seq < minBuffered) {
          minBuffered = msg.seq;
        }
      }
      if (minBuffered === Infinity) continue;
      for (let seq = expect; seq < minBuffered; seq++) {
        out.push({ from: f, seq });
      }
    }
    out.sort((a, b) => a.from - b.from || a.seq - b.seq);
    return out;
  }

  nextSeq(from: number): number {
    return this.sendSeqs[from] + 1;
  }

  localVc(from: number): number[] {
    return copy(this.localVcs[from]);
  }

  bumpSend(from: number, payload: string): CausalMessage {
    const vc = vmax(this.localVcs[from], this.delivered[from]);
    vc[from] += 1;
    this.localVcs[from] = copy(vc);
    this.sendSeqs[from] += 1;
    const msg: CausalMessage = { from, seq: this.sendSeqs[from], payload, vc };
    // Sender treats its own broadcast as delivered.
    this.delivered[from][from] += 1;
    this.seen[from].add(keyOf(from, msg.seq));
    return copyMsg(msg);
  }

  gc(minStable: number[], to: number): void {
    for (const [key, msg] of this.buffers[to]) {
      if (dominates(minStable, msg.vc)) {
        this.buffers[to].delete(key);
      }
    }
    for (const key of this.seen[to]) {
      const [fromStr, seqStr] = key.split(":");
      const from = Number(fromStr);
      const seq = Number(seqStr);
      if (seq <= minStable[from]) {
        this.seen[to].delete(key);
      }
    }
  }
}
