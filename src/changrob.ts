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
  private readonly processes: CProc[];
  private messageSequence = 0;

  constructor(opts: ChangRobOptions) {
    this.clock = opts.clock;

    const processCount = opts.processCount ?? 5;
    if (!Number.isInteger(processCount) || processCount < 2) {
      throw new InvalidConfigError("processCount must be an integer greater than or equal to 2");
    }

    const uids = opts.uids ?? defaultUids(processCount);
    if (uids.length !== processCount) {
      throw new InvalidConfigError("uids length must equal processCount");
    }

    const seen = new Set<number>();
    for (const uid of uids) {
      if (!Number.isInteger(uid) || uid < 0) {
        throw new InvalidConfigError("uids must contain non-negative integers");
      }
      if (seen.has(uid)) {
        throw new InvalidConfigError("uids must be unique");
      }
      seen.add(uid);
    }

    this.processes = uids.map((uid, id) => new CProc(id, uid));
  }

  start(id: number): string {
    const process = this.readyProcess(id);
    if (process.participant) {
      throw new BusyError(id);
    }

    process.participant = true;
    process.leader = null;
    return this.send(id, "ELECTION", process.uid);
  }

  step(id: number): boolean {
    const process = this.readyProcess(id);
    const message = process.dequeue();
    if (message === undefined) {
      return false;
    }

    if (message.kind === "ELECTION") {
      if (message.uid > process.uid) {
        this.send(id, "ELECTION", message.uid);
      } else if (message.uid < process.uid) {
        if (!process.participant) {
          process.participant = true;
          process.leader = null;
          this.send(id, "ELECTION", process.uid);
        }
      } else {
        process.leader = message.uid;
        process.participant = false;
        this.send(id, "LEADER", message.uid);
      }
    } else {
      process.leader = message.uid;
      process.participant = false;
      if (message.uid !== process.uid) {
        this.send(id, "LEADER", message.uid);
      }
    }

    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
      }
      return;
    }

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const process of this.processes) {
        if (process.online && this.step(process.id)) {
          progressed = true;
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
    let leader: number | null = null;
    let found = false;

    for (const process of this.processes) {
      if (!process.online) {
        continue;
      }
      if (!found) {
        leader = process.leader;
        found = true;
      } else if (process.leader !== leader) {
        return null;
      }
    }

    return found ? leader : null;
  }

  isParticipant(id: number): boolean {
    return this.process(id).participant;
  }

  inboxSize(id: number): number {
    return this.process(id).inbox.length;
  }

  nextOf(id: number): number {
    this.assertValidId(id);
    return nextIndex(id, this.processes.length);
  }

  setOnline(id: number, online: boolean): void {
    this.process(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.process(id).online;
  }

  private send(from: number, kind: MsgKind, uid: number): string {
    this.messageSequence += 1;
    const msgId = String(this.messageSequence);
    const message: Message = { kind, uid, from, msgId };
    this.processes[nextIndex(from, this.processes.length)].enqueue(message);
    return msgId;
  }

  private process(id: number): CProc {
    this.assertValidId(id);
    return this.processes[id];
  }

  private readyProcess(id: number): CProc {
    const process = this.process(id);
    if (!process.online) {
      throw new OfflineError(id);
    }
    return process;
  }

  private assertValidId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.processes.length) {
      throw new InvalidProcessError(id);
    }
  }
}
