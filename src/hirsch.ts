import { VirtualClock } from "./clock.js";
import { HProc } from "./process.js";
import {
  defaultUids,
  hopForPhase,
  leftIndex,
  rightIndex,
} from "./ring.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import type { Dir, Message } from "./types.js";

export type HirschOptions = {
  clock: VirtualClock;
  processCount?: number;
  uids?: number[];
};

export class Hirsch {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly procs: HProc[];
  private msgSeq = 0;

  constructor(opts: HirschOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 3) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 3, got ${n}`,
      );
    }
    const uids = opts.uids ?? defaultUids(n);
    if (uids.length !== n) {
      throw new InvalidConfigError(
        `uids length ${uids.length} does not match processCount ${n}`,
      );
    }
    const seen = new Set<number>();
    for (const uid of uids) {
      if (!Number.isInteger(uid) || uid < 0 || seen.has(uid)) {
        throw new InvalidConfigError(
          "uids must be distinct non-negative integers",
        );
      }
      seen.add(uid);
    }
    this.n = n;
    this.procs = uids.map((uid, id) => new HProc(id, uid));
  }

  start(id: number): string {
    this.checkId(id);
    if (!this.procs[id].online) {
      throw new OfflineError(id);
    }
    if (this.procs[id].participant) {
      throw new BusyError(id);
    }
    return this.begin(id);
  }

  step(id: number): boolean {
    this.checkId(id);
    const proc = this.procs[id];
    if (!proc.online) {
      throw new OfflineError(id);
    }
    const msg = proc.inbox.shift();
    if (msg === undefined) {
      return false;
    }
    switch (msg.kind) {
      case "PROBE":
        this.handleProbe(id, msg);
        break;
      case "REPLY":
        this.handleReply(id, msg);
        break;
      case "LEADER":
        this.handleLeader(id, msg);
        break;
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.checkId(to);
      while (this.step(to)) {
        // drain target inbox
      }
      return;
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (const proc of this.procs) {
        if (proc.online && proc.inbox.length > 0) {
          this.step(proc.id);
          progress = true;
        }
      }
    }
  }

  uidOf(id: number): number {
    this.checkId(id);
    return this.procs[id].uid;
  }

  leaderOf(id: number): number | null {
    this.checkId(id);
    return this.procs[id].leader;
  }

  leader(): number | null {
    let leader: number | null = null;
    for (const proc of this.procs) {
      if (!proc.online) {
        continue;
      }
      if (proc.leader === null) {
        return null;
      }
      if (leader === null) {
        leader = proc.leader;
      } else if (leader !== proc.leader) {
        return null;
      }
    }
    return leader;
  }

  isParticipant(id: number): boolean {
    this.checkId(id);
    return this.procs[id].participant;
  }

  phaseOf(id: number): number {
    this.checkId(id);
    return this.procs[id].phase;
  }

  repliesOf(id: number): number {
    this.checkId(id);
    return this.procs[id].replies;
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  leftOf(id: number): number {
    this.checkId(id);
    return leftIndex(id, this.n);
  }

  rightOf(id: number): number {
    this.checkId(id);
    return rightIndex(id, this.n);
  }

  setOnline(id: number, online: boolean): void {
    this.checkId(id);
    this.procs[id].online = online;
  }

  isOnline(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online;
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    this.msgSeq += 1;
    return String(this.msgSeq);
  }

  private deliver(to: number, msg: Message): void {
    this.procs[to].inbox.push(msg);
  }

  private neighbor(id: number, dir: Dir): number {
    return dir === "L" ? leftIndex(id, this.n) : rightIndex(id, this.n);
  }

  private opposite(dir: Dir): Dir {
    return dir === "L" ? "R" : "L";
  }

  private begin(id: number): string {
    const proc = this.procs[id];
    const uid = proc.uid;
    proc.participant = true;
    proc.leader = null;
    proc.phase = 0;
    proc.replies = 0;
    const leftId = this.nextMsgId();
    this.deliver(this.neighbor(id, "L"), {
      kind: "PROBE",
      uid,
      phase: 0,
      hop: 1,
      dir: "L",
      from: id,
      msgId: leftId,
    });
    this.deliver(this.neighbor(id, "R"), {
      kind: "PROBE",
      uid,
      phase: 0,
      hop: 1,
      dir: "R",
      from: id,
      msgId: this.nextMsgId(),
    });
    return leftId;
  }

  private declareLeader(id: number): void {
    const proc = this.procs[id];
    const uid = proc.uid;
    proc.leader = uid;
    proc.participant = false;
    for (const dir of ["L", "R"] as Dir[]) {
      this.deliver(this.neighbor(id, dir), {
        kind: "LEADER",
        uid,
        dir,
        from: id,
        msgId: this.nextMsgId(),
      });
    }
  }

  private handleProbe(id: number, msg: Extract<Message, { kind: "PROBE" }>): void {
    const proc = this.procs[id];
    if (msg.uid > proc.uid) {
      if (msg.hop > 1) {
        this.deliver(this.neighbor(id, msg.dir), {
          kind: "PROBE",
          uid: msg.uid,
          phase: msg.phase,
          hop: msg.hop - 1,
          dir: msg.dir,
          from: id,
          msgId: this.nextMsgId(),
        });
      } else {
        this.deliver(this.neighbor(id, this.opposite(msg.dir)), {
          kind: "REPLY",
          uid: msg.uid,
          phase: msg.phase,
          dir: msg.dir,
          from: id,
          msgId: this.nextMsgId(),
        });
      }
      return;
    }
    if (msg.uid < proc.uid) {
      if (!proc.participant) {
        this.begin(id);
      }
      return;
    }
    this.declareLeader(id);
  }

  private handleReply(id: number, msg: Extract<Message, { kind: "REPLY" }>): void {
    const proc = this.procs[id];
    if (msg.uid !== proc.uid) {
      this.deliver(this.neighbor(id, this.opposite(msg.dir)), {
        kind: "REPLY",
        uid: msg.uid,
        phase: msg.phase,
        dir: msg.dir,
        from: id,
        msgId: this.nextMsgId(),
      });
      return;
    }
    if (!proc.participant || proc.phase !== msg.phase) {
      return;
    }
    proc.replies += 1;
    if (proc.replies !== 2) {
      return;
    }
    if (hopForPhase(proc.phase) >= Math.floor(this.n / 2)) {
      this.declareLeader(id);
      return;
    }
    proc.phase += 1;
    proc.replies = 0;
    const hop = hopForPhase(proc.phase);
    for (const dir of ["L", "R"] as Dir[]) {
      this.deliver(this.neighbor(id, dir), {
        kind: "PROBE",
        uid: proc.uid,
        phase: proc.phase,
        hop,
        dir,
        from: id,
        msgId: this.nextMsgId(),
      });
    }
  }

  private handleLeader(id: number, msg: Extract<Message, { kind: "LEADER" }>): void {
    const proc = this.procs[id];
    proc.leader = msg.uid;
    proc.participant = false;
    if (msg.uid !== proc.uid) {
      this.deliver(this.neighbor(id, msg.dir), {
        kind: "LEADER",
        uid: msg.uid,
        dir: msg.dir,
        from: id,
        msgId: this.nextMsgId(),
      });
    }
  }
}
