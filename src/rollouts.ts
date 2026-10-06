import { fail } from "./errors";

export type RolloutStatus = "active" | "committed" | "aborted";

export interface RolloutInfo {
  id: string;
  subject: string;
  target: number;
  members: string[];
  from: Record<string, number>;
  accepts: Record<string, boolean>;
  startedAt: number;
  deadline: number;
  status: RolloutStatus;
}

export interface RolloutRecord {
  id: string;
  subject: string;
  target: number;
  members: string[];
  memberSet: Set<string>;
  from: Map<string, number>;
  decisions: Map<string, boolean>;
  startedAt: number;
  deadline: number;
  status: RolloutStatus;
}

export class Rollouts {
  private records = new Map<string, RolloutRecord>();
  private nextId = 1;

  constructor(private readonly maxRollouts?: number) {}

  begin(
    subject: string,
    target: number,
    members: string[],
    from: Map<string, number>,
    startedAt: number,
    rolloutMs: number,
  ): string {
    if (this.maxRollouts !== undefined && this.records.size >= this.maxRollouts) {
      fail("ROLLOUT_CAPACITY", "rollout capacity reached");
    }
    const id = `r${this.nextId}`;
    this.nextId += 1;
    this.create(id, subject, target, members, from, startedAt, startedAt + rolloutMs);
    return id;
  }

  restore(
    id: string,
    subject: string,
    target: number,
    members: string[],
    from: Map<string, number>,
    startedAt: number,
    deadline: number,
  ): void {
    if (this.records.has(id)) {
      fail("JOURNAL_INVALID", `duplicate rollout id "${id}"`);
    }
    this.create(id, subject, target, members, from, startedAt, deadline);
    const match = /^r(\d+)$/.exec(id);
    if (match !== null) {
      const numeric = Number(match[1]);
      if (numeric >= this.nextId) {
        this.nextId = numeric + 1;
      }
    }
  }

  private create(
    id: string,
    subject: string,
    target: number,
    members: string[],
    from: Map<string, number>,
    startedAt: number,
    deadline: number,
  ): void {
    const snapshot = [...members];
    this.records.set(id, {
      id,
      subject,
      target,
      members: snapshot,
      memberSet: new Set(snapshot),
      from: new Map(from),
      decisions: new Map(),
      startedAt,
      deadline,
      status: "active",
    });
  }

  get(id: string): RolloutRecord | undefined {
    return this.records.get(id);
  }

  require(id: string): RolloutRecord {
    const record = this.records.get(id);
    if (record === undefined) {
      fail("ROLLOUT_UNKNOWN", `rollout "${id}" does not exist`);
    }
    return record;
  }

  hasActiveFor(subject: string): boolean {
    for (const record of this.records.values()) {
      if (record.subject === subject && record.status === "active") {
        return true;
      }
    }
    return false;
  }

  activeDependsOn(subject: string, version: number): boolean {
    for (const record of this.records.values()) {
      if (record.subject !== subject || record.status !== "active") {
        continue;
      }
      if (record.target === version) {
        return true;
      }
      for (const from of record.from.values()) {
        if (from === version) {
          return true;
        }
      }
    }
    return false;
  }

  activeRollouts(): RolloutRecord[] {
    const out: RolloutRecord[] = [];
    for (const record of this.records.values()) {
      if (record.status === "active") {
        out.push(record);
      }
    }
    return out;
  }

  counts(): {
    rollouts: number;
    activeRollouts: number;
    committedRollouts: number;
    abortedRollouts: number;
  } {
    let active = 0;
    let committed = 0;
    let aborted = 0;
    for (const record of this.records.values()) {
      if (record.status === "active") {
        active += 1;
      } else if (record.status === "committed") {
        committed += 1;
      } else {
        aborted += 1;
      }
    }
    return {
      rollouts: this.records.size,
      activeRollouts: active,
      committedRollouts: committed,
      abortedRollouts: aborted,
    };
  }

  info(id: string): RolloutInfo {
    const record = this.require(id);
    const from: Record<string, number> = {};
    for (const [consumer, version] of record.from) {
      from[consumer] = version;
    }
    const accepts: Record<string, boolean> = {};
    for (const [consumer, accept] of record.decisions) {
      accepts[consumer] = accept;
    }
    return {
      id: record.id,
      subject: record.subject,
      target: record.target,
      members: [...record.members],
      from,
      accepts,
      startedAt: record.startedAt,
      deadline: record.deadline,
      status: record.status,
    };
  }
}
