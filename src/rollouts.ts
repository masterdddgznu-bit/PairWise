import { fail } from "./errors";
import type { AbortReason } from "./journal";

export type RolloutStatus = "active" | "committed" | "aborted";
export type MemberDecision = "accepted" | "rejected" | "pending";

export interface RolloutStatusInfo {
  id: string;
  subject: string;
  target: number;
  members: Record<string, MemberDecision>;
  beganAt: number;
  deadline: number;
  status: RolloutStatus;
  reason?: AbortReason;
}

export interface MemberSeed {
  consumer: string;
  fromVersion: number;
}

interface RolloutRecord {
  id: string;
  subject: string;
  target: number;
  members: Map<string, boolean | null>;
  fromVersions: Map<string, number>;
  beganAt: number;
  deadline: number;
  status: RolloutStatus;
  reason?: AbortReason;
}

export type FinalizeOutcome =
  | { kind: "committed"; id: string }
  | { kind: "aborted"; id: string; reason: AbortReason };

export class Rollouts {
  private records = new Map<string, RolloutRecord>();
  private nextSeq = 1;

  constructor(private readonly maxActive?: number) {}

  get total(): number {
    return this.records.size;
  }

  private countWhere(predicate: (record: RolloutRecord) => boolean): number {
    let total = 0;
    for (const record of this.records.values()) {
      if (predicate(record)) total += 1;
    }
    return total;
  }

  get activeCount(): number {
    return this.countWhere((record) => record.status === "active");
  }

  get committedCount(): number {
    return this.countWhere((record) => record.status === "committed");
  }

  get abortedCount(): number {
    return this.countWhere((record) => record.status === "aborted");
  }

  private record(id: string): RolloutRecord {
    const record = this.records.get(id);
    if (!record) fail("NO_SUCH_ROLLOUT", `unknown rollout: ${id}`);
    return record;
  }

  activeForSubject(subject: string): RolloutStatusInfo | undefined {
    for (const record of this.records.values()) {
      if (record.subject === subject && record.status === "active") {
        return Rollouts.snapshot(record);
      }
    }
    return undefined;
  }

  private ensureCapacity(): void {
    if (this.maxActive !== undefined && this.activeCount >= this.maxActive) {
      fail("ROLLOUT_CAPACITY", `active rollout capacity ${this.maxActive} reached`);
    }
  }

  private static snapshot(record: RolloutRecord): RolloutStatusInfo {
    const members: Record<string, MemberDecision> = {};
    for (const [consumer, decision] of record.members) {
      members[consumer] = decision === null ? "pending" : decision ? "accepted" : "rejected";
    }
    const info: RolloutStatusInfo = {
      id: record.id,
      subject: record.subject,
      target: record.target,
      members,
      beganAt: record.beganAt,
      deadline: record.deadline,
      status: record.status,
    };
    if (record.reason !== undefined) info.reason = record.reason;
    return info;
  }

  status(id: string): RolloutStatusInfo {
    return Rollouts.snapshot(this.record(id));
  }

  begin(
    subject: string,
    target: number,
    members: MemberSeed[],
    beganAt: number,
    rolloutMs: number,
  ): RolloutStatusInfo {
    this.ensureCapacity();
    const id = `r${this.nextSeq}`;
    this.nextSeq += 1;
    const record: RolloutRecord = {
      id,
      subject,
      target,
      members: new Map(members.map((member) => [member.consumer, null])),
      fromVersions: new Map(members.map((member) => [member.consumer, member.fromVersion])),
      beganAt,
      deadline: beganAt + rolloutMs,
      status: "active",
    };
    this.records.set(id, record);
    return Rollouts.snapshot(record);
  }

  ack(id: string, consumer: string, accept: boolean): "recorded" | "duplicate" {
    const record = this.record(id);
    if (record.status !== "active") {
      fail("ROLLOUT_CLOSED", `rollout ${id} is ${record.status}`);
    }
    if (!record.members.has(consumer)) {
      fail("NOT_MEMBER", `consumer ${consumer} is not a member of rollout ${id}`);
    }
    const existing = record.members.get(consumer);
    if (existing !== null && existing !== undefined) {
      if (existing === accept) return "duplicate";
      fail("ACK_CONFLICT", `consumer ${consumer} already decided ${existing} on rollout ${id}`);
    }
    record.members.set(consumer, accept);
    return "recorded";
  }

  finalize(id: string, now: number): FinalizeOutcome {
    const record = this.record(id);
    if (record.status !== "active") {
      fail("ROLLOUT_CLOSED", `rollout ${id} is ${record.status}`);
    }
    if (now >= record.deadline) {
      record.status = "aborted";
      record.reason = "expired";
      return { kind: "aborted", id, reason: "expired" };
    }
    let rejected = false;
    let pending = false;
    for (const decision of record.members.values()) {
      if (decision === null || decision === undefined) pending = true;
      else if (!decision) rejected = true;
    }
    if (rejected) {
      record.status = "aborted";
      record.reason = "rejected";
      return { kind: "aborted", id, reason: "rejected" };
    }
    if (pending) {
      fail("ACKS_PENDING", `rollout ${id} still has undecided members`);
    }
    record.status = "committed";
    return { kind: "committed", id };
  }

  drive(now: number): Array<{ id: string; reason: AbortReason }> {
    const aborted: Array<{ id: string; reason: AbortReason }> = [];
    for (const record of this.records.values()) {
      if (record.status === "active" && now >= record.deadline) {
        record.status = "aborted";
        record.reason = "expired";
        aborted.push({ id: record.id, reason: "expired" });
      }
    }
    return aborted;
  }

  membersOf(id: string): string[] {
    return [...this.record(id).members.keys()];
  }

  subjectOf(id: string): string {
    return this.record(id).subject;
  }

  targetOf(id: string): number {
    return this.record(id).target;
  }

  pinsVersion(subject: string, version: number, dependsOn: (target: number) => boolean): boolean {
    for (const record of this.records.values()) {
      if (record.subject !== subject || record.status !== "active") continue;
      if (dependsOn(record.target)) return true;
      for (const fromVersion of record.fromVersions.values()) {
        if (fromVersion === version) return true;
      }
    }
    return false;
  }

  restoreBegin(
    id: string,
    subject: string,
    target: number,
    members: MemberSeed[],
    beganAt: number,
    rolloutMs: number,
  ): void {
    const record: RolloutRecord = {
      id,
      subject,
      target,
      members: new Map(members.map((member) => [member.consumer, null])),
      fromVersions: new Map(members.map((member) => [member.consumer, member.fromVersion])),
      beganAt,
      deadline: beganAt + rolloutMs,
      status: "active",
    };
    this.records.set(id, record);
    const match = /^r(\d+)$/.exec(id);
    if (match) {
      this.nextSeq = Math.max(this.nextSeq, Number.parseInt(match[1], 10) + 1);
    }
  }

  restoreAck(id: string, consumer: string, accept: boolean): void {
    this.record(id).members.set(consumer, accept);
  }

  restoreCommit(id: string): void {
    this.record(id).status = "committed";
  }

  restoreAbort(id: string, reason: AbortReason): void {
    const record = this.record(id);
    record.status = "aborted";
    record.reason = reason;
  }
}
