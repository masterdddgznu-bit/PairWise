import { VirtualClock } from "./clock.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import { HProc } from "./process.js";
import {
  defaultUids,
  hopForPhase,
  leftIndex,
  rightIndex,
} from "./ring.js";
import type { Dir, Message } from "./types.js";

export type HirschOptions = {
  clock: VirtualClock;
  processCount?: number;
  uids?: number[];
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type OutgoingMessage = DistributiveOmit<Message, "from" | "msgId">;

export class Hirsch {
  readonly clock: VirtualClock;

  private readonly n: number;
  private readonly procs: HProc[];
  private nextMsgId = 1;

  constructor(opts: HirschOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 3) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 3, got ${String(n)}`,
      );
    }
    this.n = n;

    const uids = opts.uids ?? defaultUids(n);
    if (
      !Array.isArray(uids) ||
      uids.length !== n ||
      uids.some(
        (uid) =>
          typeof uid !== "number" ||
          !Number.isInteger(uid) ||
          uid < 0,
      ) ||
      new Set(uids).size !== n
    ) {
      throw new InvalidConfigError(
        "uids must be an array of n distinct non-negative integers",
      );
    }

    this.procs = uids.map((uid, index) => new HProc(index, uid));
  }

  private checkId(id: number): void {
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id < 0 ||
      id >= this.n
    ) {
      throw new InvalidProcessError(id);
    }
  }

  private requireOnline(id: number): HProc {
    this.checkId(id);
    const proc = this.procs[id];
    if (!proc.online) {
      throw new OfflineError(id);
    }
    return proc;
  }

  private deliver(
    to: number,
    from: number,
    partial: OutgoingMessage,
  ): void {
    this.procs[to].inbox.push({
      ...partial,
      from,
      msgId: String(this.nextMsgId++),
    } as Message);
  }

  private neighborIn(id: number, dir: Dir): number {
    return dir === "L" ? leftIndex(id, this.n) : rightIndex(id, this.n);
  }

  private static opposite(dir: Dir): Dir {
    return dir === "L" ? "R" : "L";
  }

  private initiate(proc: HProc): void {
    proc.participant = true;
    proc.leader = null;
    proc.phase = 0;
    proc.replies = 0;
    this.deliver(leftIndex(proc.id, this.n), proc.id, {
      kind: "PROBE",
      uid: proc.uid,
      phase: 0,
      hop: 1,
      dir: "L",
    });
    this.deliver(rightIndex(proc.id, this.n), proc.id, {
      kind: "PROBE",
      uid: proc.uid,
      phase: 0,
      hop: 1,
      dir: "R",
    });
  }

  private declareLeader(proc: HProc, uid: number): void {
    proc.leader = uid;
    proc.participant = false;
    proc.replies = 0;
    this.deliver(leftIndex(proc.id, this.n), proc.id, {
      kind: "LEADER",
      uid,
      dir: "L",
    });
    this.deliver(rightIndex(proc.id, this.n), proc.id, {
      kind: "LEADER",
      uid,
      dir: "R",
    });
  }

  start(id: number): string {
    const proc = this.requireOnline(id);
    if (proc.participant) {
      throw new BusyError(id);
    }
    const leftMsgId = String(this.nextMsgId);
    this.initiate(proc);
    return leftMsgId;
  }

  step(id: number): boolean {
    const proc = this.requireOnline(id);
    const message = proc.inbox.shift();
    if (message === undefined) {
      return false;
    }

    if (message.kind === "PROBE") {
      if (message.uid > proc.uid) {
        if (message.hop > 1) {
          this.deliver(this.neighborIn(proc.id, message.dir), proc.id, {
            kind: "PROBE",
            uid: message.uid,
            phase: message.phase,
            hop: message.hop - 1,
            dir: message.dir,
          });
        } else {
          this.deliver(
            this.neighborIn(proc.id, Hirsch.opposite(message.dir)),
            proc.id,
            {
              kind: "REPLY",
              uid: message.uid,
              phase: message.phase,
              dir: message.dir,
            },
          );
        }
      } else if (message.uid < proc.uid) {
        if (!proc.participant) {
          this.initiate(proc);
        }
      } else {
        this.declareLeader(proc, message.uid);
      }
      return true;
    }

    if (message.kind === "REPLY") {
      if (message.uid !== proc.uid) {
        this.deliver(
          this.neighborIn(proc.id, Hirsch.opposite(message.dir)),
          proc.id,
          {
            kind: "REPLY",
            uid: message.uid,
            phase: message.phase,
            dir: message.dir,
          },
        );
        return true;
      }

      if (message.phase === proc.phase && proc.participant) {
        proc.replies += 1;
        if (proc.replies === 2) {
          if (hopForPhase(proc.phase) >= Math.floor(this.n / 2)) {
            this.declareLeader(proc, proc.uid);
          } else {
            proc.phase += 1;
            proc.replies = 0;
            const hop = hopForPhase(proc.phase);
            this.deliver(leftIndex(proc.id, this.n), proc.id, {
              kind: "PROBE",
              uid: proc.uid,
              phase: proc.phase,
              hop,
              dir: "L",
            });
            this.deliver(rightIndex(proc.id, this.n), proc.id, {
              kind: "PROBE",
              uid: proc.uid,
              phase: proc.phase,
              hop,
              dir: "R",
            });
          }
        }
      }
      return true;
    }

    proc.leader = message.uid;
    proc.participant = false;
    proc.replies = 0;
    if (message.uid !== proc.uid) {
      this.deliver(this.neighborIn(proc.id, message.dir), proc.id, {
        kind: "LEADER",
        uid: message.uid,
        dir: message.dir,
      });
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
        // drain the inbox of process `to`
      }
      return;
    }

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const proc of this.procs) {
        if (proc.online && proc.inbox.length > 0) {
          this.step(proc.id);
          progressed = true;
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
    let value: number | null = null;
    for (const proc of this.procs) {
      if (!proc.online) {
        continue;
      }
      if (proc.leader === null || (value !== null && proc.leader !== value)) {
        return null;
      }
      value = proc.leader;
    }
    return value;
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
}
