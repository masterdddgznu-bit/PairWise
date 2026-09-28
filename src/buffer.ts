import type { CausalMessage, Missing } from "./types.js";
import { dominates, zeros } from "./vclock.js";

export class CausalBuffer {
  private readonly n: number;
  private readonly del: number[][];
  private readonly buf: CausalMessage[][];
  private readonly seen: Set<string>[];

  constructor(n: number) {
    this.n = n;
    this.del = Array.from({ length: n }, () => zeros(n));
    this.buf = Array.from({ length: n }, () => []);
    this.seen = Array.from({ length: n }, () => new Set<string>());
  }

  private static key(from: number, seq: number): string {
    return `${from}:${seq}`;
  }

  private static clone(msg: CausalMessage): CausalMessage {
    return { from: msg.from, seq: msg.seq, payload: msg.payload, vc: msg.vc.slice() };
  }

  bumpSend(from: number, payload: string): CausalMessage {
    const seq = this.del[from][from] + 1;
    const vc = this.del[from].slice();
    vc[from] = seq;
    const msg: CausalMessage = { from, seq, payload, vc };
    this.del[from][from] = seq;
    this.seen[from].add(CausalBuffer.key(from, seq));
    return CausalBuffer.clone(msg);
  }

  receive(to: number, msg: CausalMessage): boolean {
    if (msg.seq <= this.del[to][msg.from]) return false;
    const key = CausalBuffer.key(msg.from, msg.seq);
    if (this.seen[to].has(key)) return false;
    this.buf[to].push(CausalBuffer.clone(msg));
    this.seen[to].add(key);
    return true;
  }

  deliver(to: number): CausalMessage | null {
    const box = this.buf[to];
    const del = this.del[to];
    let pick = -1;
    for (let i = 0; i < box.length; i++) {
      const m = box[i];
      if (!this.deliverable(m, del)) continue;
      if (pick === -1 || m.from < box[pick].from ||
        (m.from === box[pick].from && m.seq < box[pick].seq)) {
        pick = i;
      }
    }
    if (pick === -1) return null;
    const [msg] = box.splice(pick, 1);
    del[msg.from] += 1;
    return CausalBuffer.clone(msg);
  }

  private deliverable(m: CausalMessage, del: number[]): boolean {
    if (m.vc[m.from] !== del[m.from] + 1) return false;
    for (let k = 0; k < this.n; k++) {
      if (k !== m.from && m.vc[k] > del[k]) return false;
    }
    return true;
  }

  buffered(to: number): number {
    return this.buf[to].length;
  }

  deliveredClock(to: number): number[] {
    return this.del[to].slice();
  }

  missing(to: number): Missing[] {
    const out: Missing[] = [];
    const del = this.del[to];
    for (let f = 0; f < this.n; f++) {
      if (f === to) continue;
      const expect = del[f] + 1;
      let minSeq = Infinity;
      for (const m of this.buf[to]) {
        if (m.from === f && m.seq < minSeq) minSeq = m.seq;
      }
      for (let seq = expect; seq < minSeq; seq++) {
        out.push({ from: f, seq });
      }
    }
    return out;
  }

  gc(stable: number[]): void {
    for (let to = 0; to < this.n; to++) {
      const box = this.buf[to];
      const kept: CausalMessage[] = [];
      for (const m of box) {
        if (dominates(stable, m.vc)) {
          continue;
        }
        kept.push(m);
      }
      this.buf[to] = kept;
      for (const key of Array.from(this.seen[to])) {
        const sep = key.indexOf(":");
        const from = Number(key.slice(0, sep));
        const seq = Number(key.slice(sep + 1));
        if (seq <= stable[from]) this.seen[to].delete(key);
      }
    }
  }

  isEmpty(to: number): boolean {
    return this.buf[to].length === 0;
  }
}
