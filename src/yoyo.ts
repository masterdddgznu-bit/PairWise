import { VirtualClock } from "./clock.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import { buildNeighbors, defaultEdges, defaultUids, isConnected } from "./graph.js";
import { YProc } from "./process.js";
import type { Message } from "./types.js";

export type YoYoOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  uids?: number[];
};

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export class YoYo {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private readonly uids: number[];
  private readonly staticNeighbors: number[][];
  private readonly edgeList: Array<[number, number]>;
  private readonly procs: YProc[];
  private active = new Set<string>();
  private convergedFlag = false;
  private leaderUid: number | null = null;
  private roundActive = false;
  private msgCounter = 0;

  constructor(opts: YoYoOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const uids = opts.uids ?? defaultUids(n);
    if (uids.length !== n) {
      throw new InvalidConfigError(`uids length ${uids.length} does not match processCount ${n}`);
    }
    if (!uids.every((u) => Number.isInteger(u))) {
      throw new InvalidConfigError("uids must be integers");
    }
    if (new Set(uids).size !== n) {
      throw new InvalidConfigError("uids must be unique");
    }
    const rawEdges = opts.edges ?? defaultEdges(n);
    const seen = new Set<string>();
    const edges: Array<[number, number]> = [];
    for (const e of rawEdges) {
      if (!Array.isArray(e) || e.length !== 2) {
        throw new InvalidConfigError("each edge must be a [number, number] pair");
      }
      const [a, b] = e;
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        b < 0 ||
        a >= n ||
        b >= n ||
        a === b
      ) {
        throw new InvalidConfigError(`invalid edge: [${a}, ${b}]`);
      }
      const key = edgeKey(a, b);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph is not connected");
    }
    this.processCount = n;
    this.uids = [...uids];
    this.edgeList = edges;
    this.staticNeighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, i) => new YProc(i));
    this.reset();
  }

  reset(): void {
    this.active = new Set(this.edgeList.map(([a, b]) => edgeKey(a, b)));
    this.convergedFlag = false;
    this.leaderUid = null;
    this.roundActive = false;
    for (const p of this.procs) p.reset();
  }

  begin(): number {
    if (this.inProgress()) throw new BusyError("round in progress");
    if (this.convergedFlag) return 0;
    const online = this.onlineIds();
    if (online.length === 0) throw new InvalidConfigError("no online processes");
    if (!this.onlineConnected(online)) {
      throw new InvalidConfigError("online subgraph is not connected");
    }
    this.roundActive = true;
    let sent = 0;
    for (const id of online) {
      const p = this.procs[id];
      p.inExpect = this.inNeighbors(id);
      p.outExpect = this.outNeighbors(id);
      p.downRecv.clear();
      p.upRecv.clear();
      if (p.inExpect.length === 0 && p.outExpect.length === 0) {
        p.phase = "idle";
      } else if (p.inExpect.length === 0) {
        p.phase = "up";
        for (const nb of p.outExpect) {
          if (
            this.deliver(nb, {
              kind: "DOWN",
              cand: this.uids[id],
              from: id,
              msgId: this.nextMsgId(),
            })
          ) {
            sent++;
          }
        }
      } else {
        p.phase = "down";
      }
    }
    this.checkRoundComplete();
    return sent;
  }

  step(id: number): boolean {
    this.checkId(id);
    const p = this.procs[id];
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    if (msg.kind === "DOWN") this.handleDown(p, msg);
    else this.handleUp(p, msg);
    this.checkRoundComplete();
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.checkId(to);
      while (this.step(to)) {
        /* drain */
      }
      return;
    }
    let again = true;
    while (again) {
      again = false;
      for (const p of this.procs) {
        if (p.online && p.inbox.length > 0) {
          this.step(p.id);
          again = true;
        }
      }
    }
  }

  uidOf(id: number): number {
    this.checkId(id);
    return this.uids[id];
  }

  activeNeighbors(id: number): number[] {
    this.checkId(id);
    return this.staticNeighbors[id].filter((nb) => this.active.has(edgeKey(id, nb)));
  }

  outNeighbors(id: number): number[] {
    this.checkId(id);
    if (!this.procs[id].online) return [];
    return this.staticNeighbors[id].filter(
      (nb) =>
        this.procs[nb].online &&
        this.active.has(edgeKey(id, nb)) &&
        this.uids[id] > this.uids[nb],
    );
  }

  inNeighbors(id: number): number[] {
    this.checkId(id);
    if (!this.procs[id].online) return [];
    return this.staticNeighbors[id].filter(
      (nb) =>
        this.procs[nb].online &&
        this.active.has(edgeKey(id, nb)) &&
        this.uids[id] < this.uids[nb],
    );
  }

  isSource(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online && this.inNeighbors(id).length === 0;
  }

  isSink(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online && this.outNeighbors(id).length === 0;
  }

  sources(): number[] {
    const result: number[] = [];
    for (let id = 0; id < this.processCount; id++) {
      if (this.isSource(id)) result.push(id);
    }
    return result;
  }

  leader(): number | null {
    return this.convergedFlag ? this.leaderUid : null;
  }

  converged(): boolean {
    return this.convergedFlag;
  }

  barrier(): number | null {
    while (!this.convergedFlag) {
      if (this.inProgress()) break;
      const activeBefore = this.active.size;
      let sent: number;
      try {
        sent = this.begin();
      } catch (err) {
        if (err instanceof InvalidConfigError) break;
        throw err;
      }
      this.pump();
      if (this.inProgress()) break;
      if (sent === 0 && !this.convergedFlag) break;
      if (!this.convergedFlag && this.active.size === activeBefore) break;
    }
    return this.leader();
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.staticNeighbors[id]];
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.checkId(id);
    if (this.inProgress()) {
      throw new BusyError("cannot change online status during a round");
    }
    this.procs[id].online = online;
  }

  isOnline(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online;
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    return `m${this.clock.now()}-${this.msgCounter++}`;
  }

  private deliver(to: number, msg: Message): boolean {
    const target = this.procs[to];
    if (!target.online) return false;
    target.inbox.push(msg);
    return true;
  }

  private inProgress(): boolean {
    return this.procs.some((p) => p.phase !== "idle");
  }

  private onlineIds(): number[] {
    const result: number[] = [];
    for (let id = 0; id < this.processCount; id++) {
      if (this.procs[id].online) result.push(id);
    }
    return result;
  }

  private onlineConnected(online: number[]): boolean {
    const onlineSet = new Set(online);
    const seen = new Set<number>([online[0]]);
    const queue: number[] = [online[0]];
    while (queue.length > 0) {
      const cur = queue.pop() as number;
      for (const nb of this.staticNeighbors[cur]) {
        if (!onlineSet.has(nb) || seen.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
    return seen.size === onlineSet.size;
  }

  private checkRoundComplete(): void {
    if (!this.roundActive || this.inProgress()) return;
    this.roundActive = false;
    const src = this.sources();
    if (src.length === 1) {
      this.convergedFlag = true;
      this.leaderUid = this.uids[src[0]];
    }
  }

  private handleDown(p: YProc, msg: Extract<Message, { kind: "DOWN" }>): void {
    if (p.phase !== "down" || !p.inExpect.includes(msg.from) || p.downRecv.has(msg.from)) {
      return;
    }
    p.downRecv.set(msg.from, msg.cand);
    if (p.downRecv.size < p.inExpect.length) return;
    let cand = -Infinity;
    for (const c of p.downRecv.values()) cand = Math.max(cand, c);
    if (p.outExpect.length === 0) {
      for (const f of p.inExpect) {
        this.deliver(f, {
          kind: "UP",
          keep: p.downRecv.get(f) === cand,
          from: p.id,
          msgId: this.nextMsgId(),
        });
      }
      p.phase = "idle";
    } else {
      for (const nb of p.outExpect) {
        this.deliver(nb, { kind: "DOWN", cand, from: p.id, msgId: this.nextMsgId() });
      }
      p.phase = "up";
    }
  }

  private handleUp(p: YProc, msg: Extract<Message, { kind: "UP" }>): void {
    if (p.phase !== "up" || !p.outExpect.includes(msg.from) || p.upRecv.has(msg.from)) {
      return;
    }
    p.upRecv.set(msg.from, msg.keep);
    if (!msg.keep) this.active.delete(edgeKey(p.id, msg.from));
    if (p.upRecv.size < p.outExpect.length) return;
    if (p.inExpect.length === 0) {
      p.phase = "idle";
      return;
    }
    let anyKeep = false;
    for (const keep of p.upRecv.values()) anyKeep = anyKeep || keep;
    let best = -Infinity;
    for (const c of p.downRecv.values()) best = Math.max(best, c);
    let chosen = -1;
    for (const f of p.inExpect) {
      if (p.downRecv.get(f) === best && (chosen === -1 || this.uids[f] > this.uids[chosen])) {
        chosen = f;
      }
    }
    for (const f of p.inExpect) {
      this.deliver(f, {
        kind: "UP",
        keep: anyKeep && f === chosen,
        from: p.id,
        msgId: this.nextMsgId(),
      });
    }
    p.phase = "idle";
  }
}
