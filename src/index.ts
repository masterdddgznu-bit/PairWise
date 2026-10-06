import { Consumers } from "./consumers";
import { deepClone } from "./clone";
import { fail, SchemaEvoError } from "./errors";
import { Journal, JournalEntry } from "./journal";
import { Registry, VersionInfo } from "./registry";
import { Rollouts, RolloutInfo, RolloutStatus } from "./rollouts";

export { SchemaEvoError } from "./errors";
export type { JournalEntry } from "./journal";
export type { VersionInfo } from "./registry";
export type { RolloutInfo, RolloutStatus } from "./rollouts";

export interface VirtualClock {
  now(): number;
}

export interface SchemaEvoOptions {
  clock: VirtualClock;
  rolloutMs: number;
  maxSubjects?: number;
  maxVersions?: number;
  maxConsumers?: number;
  maxRollouts?: number;
}

export interface Reports {
  subjects: number;
  versions: number;
  consumers: number;
  rollouts: number;
  activeRollouts: number;
  committedRollouts: number;
  abortedRollouts: number;
}

interface RolloutBeginData {
  id: string;
  subject: string;
  target: number;
  members: string[];
  from: Record<string, number>;
  startedAt: number;
  deadline: number;
}

export class SchemaEvo {
  private readonly clock: VirtualClock;
  private readonly rolloutMs: number;
  private readonly maxVersions?: number;
  private readonly registry: Registry;
  private readonly consumers: Consumers;
  private readonly rollouts: Rollouts;
  private readonly log: Journal;

  constructor(options: SchemaEvoOptions) {
    this.clock = options.clock;
    this.rolloutMs = options.rolloutMs;
    this.maxVersions = options.maxVersions;
    this.registry = new Registry(options.maxSubjects);
    this.consumers = new Consumers(options.maxConsumers);
    this.rollouts = new Rollouts(options.maxRollouts);
    this.log = new Journal();
  }

  static fromJournal(options: SchemaEvoOptions, journal: unknown): SchemaEvo {
    const entries = Journal.validate(journal);
    const evo = new SchemaEvo(options);
    evo.log.load(entries);
    for (const entry of entries) {
      evo.replay(entry);
    }
    return evo;
  }

  registerSubject(subject: string, schema: unknown): void {
    this.registry.registerSubject(subject, schema);
    this.consumers.attachSubject(subject);
    this.log.append("registerSubject", { subject, schema });
  }

  addVersion(subject: string, schema: unknown, compatibleWith: number[]): number {
    const version = this.registry.addVersion(
      subject,
      schema,
      compatibleWith,
      this.maxVersions,
    );
    this.log.append("addVersion", {
      subject,
      version,
      schema,
      compatibleWith: this.registry.versions(subject)[version - 1].compatibleWith,
    });
    return version;
  }

  registerConsumer(consumer: string): void {
    this.consumers.register(consumer, this.registry.subjectNames());
    this.log.append("registerConsumer", { consumer });
  }

  beginRollout(subject: string, targetVersion: number, consumers?: string[]): string {
    if (!this.registry.hasSubject(subject)) {
      fail("SUBJECT_UNKNOWN", `subject "${subject}" is not registered`);
    }
    if (!this.registry.hasVersion(subject, targetVersion)) {
      fail("VERSION_UNKNOWN", `version ${targetVersion} does not exist on "${subject}"`);
    }
    if (this.registry.isRetired(subject, targetVersion)) {
      fail("VERSION_RETIRED", `version ${targetVersion} on "${subject}" is retired`);
    }
    if (this.rollouts.hasActiveFor(subject)) {
      fail("ROLLOUT_ACTIVE", `subject "${subject}" already has an active rollout`);
    }
    const members = consumers === undefined ? this.consumers.names() : [...consumers];
    const seen = new Set<string>();
    const from = new Map<string, number>();
    for (const member of members) {
      if (seen.has(member)) {
        continue;
      }
      seen.add(member);
      if (!this.consumers.has(member)) {
        fail("CONSUMER_UNKNOWN", `consumer "${member}" is not registered`);
      }
      const current = this.consumers.version(member, subject);
      if (!this.registry.reachable(subject, current, targetVersion)) {
        fail(
          "INCOMPATIBLE",
          `consumer "${member}" cannot reach version ${targetVersion} from ${current}`,
        );
      }
      from.set(member, current);
    }
    const id = this.rollouts.begin(
      subject,
      targetVersion,
      [...seen],
      from,
      this.clock.now(),
      this.rolloutMs,
    );
    const record = this.rollouts.require(id);
    const fromData: Record<string, number> = {};
    for (const [member, version] of record.from) {
      fromData[member] = version;
    }
    this.log.append("beginRollout", {
      id,
      subject,
      target: targetVersion,
      members: [...record.members],
      from: fromData,
      startedAt: record.startedAt,
      deadline: record.deadline,
    } satisfies RolloutBeginData);
    return id;
  }

  ack(rolloutId: string, consumer: string, accept: boolean): void {
    const record = this.rollouts.require(rolloutId);
    if (record.status !== "active") {
      fail("ROLLOUT_CLOSED", `rollout "${rolloutId}" is already ${record.status}`);
    }
    if (!record.memberSet.has(consumer)) {
      fail("NOT_MEMBER", `consumer "${consumer}" is not a member of "${rolloutId}"`);
    }
    const existing = record.decisions.get(consumer);
    if (existing !== undefined) {
      if (existing === accept) {
        return;
      }
      fail("ACK_CONFLICT", `consumer "${consumer}" already decided ${existing}`);
    }
    record.decisions.set(consumer, accept);
    this.log.append("ack", { id: rolloutId, consumer, accept });
  }

  finalize(rolloutId: string): "committed" | "aborted" {
    const record = this.rollouts.require(rolloutId);
    if (record.status !== "active") {
      fail("ROLLOUT_CLOSED", `rollout "${rolloutId}" is already ${record.status}`);
    }
    let rejected = false;
    let pending = false;
    for (const member of record.members) {
      const decision = record.decisions.get(member);
      if (decision === undefined) {
        pending = true;
      }
      if (decision === false) {
        rejected = true;
      }
    }
    if (rejected) {
      record.status = "aborted";
      this.log.append("abort", { id: record.id });
      return "aborted";
    }
    if (pending) {
      fail("ACKS_PENDING", `rollout "${rolloutId}" still has pending members`);
    }
    if (this.clock.now() >= record.deadline) {
      record.status = "aborted";
      this.log.append("abort", { id: record.id });
      return "aborted";
    }
    record.status = "committed";
    this.registry.setCurrent(record.subject, record.target);
    for (const member of record.members) {
      this.consumers.advance(member, record.subject, record.target);
    }
    this.log.append("commit", { id: record.id });
    return "committed";
  }

  drive(): string[] {
    const now = this.clock.now();
    const aborted: string[] = [];
    for (const record of this.rollouts.activeRollouts()) {
      if (now >= record.deadline) {
        record.status = "aborted";
        this.log.append("abort", { id: record.id });
        aborted.push(record.id);
      }
    }
    return aborted;
  }

  retire(subject: string, version: number): void {
    if (!this.registry.hasSubject(subject)) {
      fail("SUBJECT_UNKNOWN", `subject "${subject}" is not registered`);
    }
    if (!this.registry.hasVersion(subject, version)) {
      fail("VERSION_UNKNOWN", `version ${version} does not exist on "${subject}"`);
    }
    if (this.registry.isRetired(subject, version)) {
      fail("VERSION_RETIRED", `version ${version} on "${subject}" is already retired`);
    }
    if (this.registry.currentVersion(subject) === version) {
      fail("RETIRE_CURRENT", `version ${version} is the current version of "${subject}"`);
    }
    if (this.consumers.anyoneAt(subject, version)) {
      fail("RETIRE_IN_USE", `version ${version} of "${subject}" still has consumers`);
    }
    let hasSuccessor = false;
    for (const info of this.registry.versions(subject)) {
      if (
        info.version !== version &&
        !info.retired &&
        this.registry.reachable(subject, version, info.version)
      ) {
        hasSuccessor = true;
        break;
      }
    }
    if (!hasSuccessor) {
      fail("RETIRE_NO_SUCCESSOR", `version ${version} of "${subject}" has no successor`);
    }
    if (this.rollouts.activeDependsOn(subject, version)) {
      fail("RETIRE_ACTIVE", `version ${version} of "${subject}" is pinned by an active rollout`);
    }
    this.registry.retire(subject, version);
    this.log.append("retire", { subject, version });
  }

  status(rolloutId: string): RolloutInfo {
    return this.rollouts.info(rolloutId);
  }

  currentVersion(subject: string): number {
    return this.registry.currentVersion(subject);
  }

  consumerVersion(consumer: string, subject: string): number {
    return this.consumers.version(consumer, subject);
  }

  versions(subject: string): VersionInfo[] {
    return this.registry.versions(subject);
  }

  reports(): Reports {
    const rolloutCounts = this.rollouts.counts();
    return {
      subjects: this.registry.subjectNames().length,
      versions: this.registry.versionCount(),
      consumers: this.consumers.size,
      rollouts: rolloutCounts.rollouts,
      activeRollouts: rolloutCounts.activeRollouts,
      committedRollouts: rolloutCounts.committedRollouts,
      abortedRollouts: rolloutCounts.abortedRollouts,
    };
  }

  journal(): JournalEntry[] {
    return this.log.snapshot();
  }

  private replay(entry: JournalEntry): void {
    const data = entry.data as Record<string, unknown>;
    switch (entry.type) {
      case "registerSubject": {
        const subject = data.subject as string;
        this.registry.registerSubject(subject, deepClone(data.schema));
        this.consumers.attachSubject(subject);
        break;
      }
      case "addVersion": {
        this.registry.addVersion(
          data.subject as string,
          deepClone(data.schema),
          deepClone(data.compatibleWith),
          this.maxVersions,
        );
        break;
      }
      case "registerConsumer": {
        this.consumers.register(data.consumer as string, this.registry.subjectNames());
        break;
      }
      case "beginRollout": {
        const begin = data as unknown as RolloutBeginData;
        const from = new Map<string, number>();
        for (const member of begin.members) {
          from.set(member, begin.from[member]);
        }
        this.rollouts.restore(
          begin.id,
          begin.subject,
          begin.target,
          begin.members,
          from,
          begin.startedAt,
          begin.deadline,
        );
        break;
      }
      case "ack": {
        const record = this.rollouts.require(data.id as string);
        record.decisions.set(data.consumer as string, data.accept as boolean);
        break;
      }
      case "commit": {
        const record = this.rollouts.require(data.id as string);
        record.status = "committed";
        this.registry.setCurrent(record.subject, record.target);
        for (const member of record.members) {
          this.consumers.advance(member, record.subject, record.target);
        }
        break;
      }
      case "abort": {
        const record = this.rollouts.require(data.id as string);
        record.status = "aborted";
        break;
      }
      case "retire": {
        this.registry.retire(data.subject as string, data.version as number);
        break;
      }
      default:
        fail("JOURNAL_INVALID", `unknown journal entry type "${entry.type}"`);
    }
  }
}
