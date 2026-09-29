import { VirtualClock } from "./clock.js";
import { BusyError, InvalidConfigError, InvalidProcessError, OfflineError } from "./errors.js";
import { CProc } from "./process.js";
import { defaultUids, nextIndex } from "./ring.js";
import type { Message, MsgKind } from "./types.js";

export type ChangRobOptions = {
  clock: VirtualClock;
  processCount?: number;
  uids?: number[];
};

export class ChangRob {
  readonly clock: VirtualClock;
  private readonly processCount: number;
  private readonly processes: CProc[];
  private messageSequence = 0;

  constructor(opts: ChangRobOptions) {
    const processCount = opts.processCount ?? 5;
    if (!Number.isInteger(processCount) || processCount < 2) {
      throw new InvalidConfigError("processCount must be an integer greater than or equal to 2");
    }

    const uids = opts.uids ?? defaultUids(processCount);
    if (!Array.isArray(uids) || uids.length !== processCount) {
      throw new InvalidConfigError("uids length must equal processCount");
    }

    const seen = new Set<number>();
    for (const uid of uids) {
      if (!Number.isInteger(uid) || uid < 0 || seen.has(uid)) {
        throw new InvalidConfigError("uids must be unique non-negative integers");
      }
      seen.add(uid);
    }

    this.clock = opts.clock;
    this.processCount = processCount;
    this.processes = uids.map((uid, id) => new CProc(id, uid));
  }

  start(id: number): string {
    const process = this.onlineProcess(id);
    if (process.participant) {
      throw new BusyError(id);
    }

    process.participant = true;
    process.leader = null;
    return this.deliver(id, "ELECTION", process.uid);
  }

  step(id: number): boolean {
    const process = this.onlineProcess(id);
    const message = process.dequeue();
    if (message === undefined) {
      return false;
    }

    if (message.kind === "ELECTION") {
      this.handleElection(id, process, message.uid);
    } else {
      this.handleLeader(id, process, message.uid);
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
      }
      return;
    }

    let madeProgress = true;
    while (madeProgress) {
      madeProgress = false;
      for (const process of this.processes) {
        if (process.online && this.step(process.id)) {
          madeProgress = true;
        }
      }
    }
  }

  uidOf(id: number): number {
    return this.process(id).uid;
  }

  leaderOf(id: number): number | null {
    return this.process(id).leader;
  }

  leader(): number | null {
    let commonLeader: number | null = null;

    for (const process of this.processes) {
      if (!process.online) {
        continue;
      }
      if (process.leader === null) {
        return null;
      }
      if (commonLeader === null) {
        commonLeader = process.leader;
      } else if (commonLeader !== process.leader) {
        return null;
      }
    }

    return commonLeader;
  }

  isParticipant(id: number): boolean {
    return this.process(id).participant;
  }

  inboxSize(id: number): number {
    return this.process(id).inbox.length;
  }

  nextOf(id: number): number {
    this.process(id);
    return nextIndex(id, this.processCount);
  }

  setOnline(id: number, online: boolean): void {
    this.process(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.process(id).online;
  }

  private process(id: number): CProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
    return this.processes[id];
  }

  private onlineProcess(id: number): CProc {
    const process = this.process(id);
    if (!process.online) {
      throw new OfflineError(id);
    }
    return process;
  }

  private deliver(from: number, kind: MsgKind, uid: number): string {
    const msgId = String(++this.messageSequence);
    this.processes[nextIndex(from, this.processCount)].enqueue({
      kind,
      uid,
      from,
      msgId,
    });
    return msgId;
  }

  private handleElection(id: number, process: CProc, uid: number): void {
    if (uid > process.uid) {
      this.deliver(id, "ELECTION", uid);
    } else if (uid < process.uid) {
      if (!process.participant) {
        process.participant = true;
        process.leader = null;
        this.deliver(id, "ELECTION", process.uid);
      }
    } else {
      process.leader = uid;
      process.participant = false;
      this.deliver(id, "LEADER", uid);
    }
  }

  private handleLeader(id: number, process: CProc, uid: number): void {
    process.leader = uid;
    process.participant = false;
    if (uid !== process.uid) {
      this.deliver(id, "LEADER", uid);
    }
  }
}
