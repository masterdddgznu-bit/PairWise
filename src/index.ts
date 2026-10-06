import { Consumers } from "./consumers";
import { SchemaEvoError, fail } from "./errors";
import { JournalData, JournalEntry, Wal } from "./journal";
import { Registry, VersionInfo } from "./registry";
import { MemberSeed, Rollouts, RolloutStatusInfo } from "./rollouts";
import type { SchemaEvoOptions } from "./clock";

export { SchemaEvo, SchemaEvo as default };
export { SchemaEvoError } from "./errors";
export type { SchemaEvoErrorCode } from "./errors";
export type { VirtualClock, SchemaEvoOptions } from "./clock";
export type { JournalData, JournalEntry, AbortReason } from "./journal";
export type { VersionInfo } from "./registry";
export type { MemberDecision, RolloutStatus, RolloutStatusInfo } from "./rollouts";

export interface Reports {
  subjects: number;
  versions: number;
  retiredVersions: number;
  consumers: number;
  rollouts: number;
  activeRollouts: number;
  committedRollouts: number;
  abortedRollouts: number;
}

class SchemaEvo {
  private readonly options: SchemaEvoOptions;
  private readonly registry: Registry;
  private readonly consumers: Consumers;
  private readonly rollouts: Rollouts;
  private readonly wal: Wal;

  constructor(options: SchemaEvoOptions) {
    this.options = options;
    this.registry = new Registry(options.maxSubjects, options.maxVersions);
    this.consumers = new Consumers(options.maxConsumers);
    this.rollouts = new Rollouts(options.maxRollouts);
    this.wal = new Wal();
  }

  static fromJournal(options: SchemaEvoOptions, journal: JournalEntry[]): SchemaEvo {
    const entries = Wal.validate(journal);
    const evo = new SchemaEvo(options);
    for (const entry of entries) {
      try {
        evo.applyData(entry.data);
      } catch (error) {
        if (error instanceof SchemaEvoError) throw error;
        fail("JOURNAL_ENTRY", `journal entry ${entry.seq} could not be replayed`);
      }
    }
    return evo;
  }

  private applyData(data: JournalData): void {
    switch (data.type) {
      case "subject-registered":
        this.registry.registerSubject(data.subject, data.schema);
        this.consumers.placeSubject(data.subject, 1);
        break;
      case "version-added":
        this.registry.restoreVersion(data.subject, data.version, data.schema, data.compatibleWith);
        break;
      case "version-retired":
        this.registry.retire(data.subject, data.version);
        break;
      case "consumer-registered":
        this.consumers.register(data.consumer, this.placements());
        break;
      case "rollout-began":
        this.rollouts.restoreBegin(
          data.id,
          data.subject,
          data.target,
          this.memberSeeds(data.subject, data.members),
          data.beganAt,
          this.options.rolloutMs,
        );
        break;
      case "ack":
        this.rollouts.restoreAck(data.id, data.consumer, data.accept);
        break;
      case "rollout-committed":
        this.commitRollout(data.id);
        break;
      case "rollout-aborted":
        this.rollouts.restoreAbort(data.id, data.reason);
        break;
    }
    this.wal.append(data);
  }

  private placements(): Array<[string, number]> {
    return this.registry.subjectNames().map((name) => [name, this.registry.currentVersion(name)]);
  }

  private memberSeeds(subject: string, members: string[]): MemberSeed[] {
    return members.map((consumer) => ({
      consumer,
      fromVersion: this.consumers.version(consumer, subject),
    }));
  }

  private commitRollout(id: string): void {
    const subject = this.rollouts.subjectOf(id);
    const target = this.rollouts.targetOf(id);
    this.rollouts.restoreCommit(id);
    this.registry.advanceCurrent(subject, target);
    this.registry.noteCommitted(subject, target);
    for (const member of this.rollouts.membersOf(id)) {
      this.consumers.advance(member, subject, target);
    }
  }

  registerSubject(name: string, schema: unknown): void {
    this.registry.registerSubject(name, schema);
    this.consumers.placeSubject(name, 1);
    this.wal.append({ type: "subject-registered", subject: name, schema });
  }

  addVersion(subject: string, schema: unknown, compatibleWith: number[]): number {
    const version = this.registry.addVersion(subject, schema, compatibleWith);
    const info = this.registry
      .versions(subject)
      .find((record) => record.version === version) as VersionInfo;
    this.wal.append({
      type: "version-added",
      subject,
      version,
      schema,
      compatibleWith: info.compatibleWith,
    });
    return version;
  }

  registerConsumer(name: string): void {
    this.consumers.register(name, this.placements());
    this.wal.append({ type: "consumer-registered", consumer: name });
  }

  beginRollout(subject: string, targetVersion: number, consumers?: string[]): string {
    if (!this.registry.hasSubject(subject)) {
      fail("NO_SUCH_SUBJECT", `unknown subject: ${subject}`);
    }
    if (!this.registry.hasVersion(subject, targetVersion)) {
      fail("NO_SUCH_VERSION", `subject ${subject} has no version ${targetVersion}`);
    }
    if (this.registry.isRetired(subject, targetVersion)) {
      fail("TARGET_RETIRED", `version ${targetVersion} of ${subject} is retired`);
    }
    if (this.rollouts.activeForSubject(subject)) {
      fail("ROLLOUT_ACTIVE", `subject ${subject} already has an active rollout`);
    }
    const requested = consumers ?? this.consumers.names();
    const members = [...new Set(requested)];
    for (const member of members) {
      if (!this.consumers.has(member)) {
        fail("NO_SUCH_CONSUMER", `unknown consumer: ${member}`);
      }
    }
    const seeds = this.memberSeeds(subject, members);
    for (const seed of seeds) {
      if (!this.registry.reachable(subject, seed.fromVersion, targetVersion)) {
        fail(
          "INCOMPATIBLE",
          `consumer ${seed.consumer} at version ${seed.fromVersion} cannot reach ${targetVersion}`,
        );
      }
    }
    const beganAt = this.options.clock.now();
    const info = this.rollouts.begin(subject, targetVersion, seeds, beganAt, this.options.rolloutMs);
    this.wal.append({
      type: "rollout-began",
      id: info.id,
      subject,
      target: targetVersion,
      members,
      beganAt,
    });
    return info.id;
  }

  ack(rolloutId: string, consumer: string, accept: boolean): void {
    const result = this.rollouts.ack(rolloutId, consumer, accept);
    if (result === "recorded") {
      this.wal.append({ type: "ack", id: rolloutId, consumer, accept });
    }
  }

  finalize(rolloutId: string): "committed" | "aborted" {
    const outcome = this.rollouts.finalize(rolloutId, this.options.clock.now());
    if (outcome.kind === "committed") {
      this.commitRollout(rolloutId);
      this.wal.append({ type: "rollout-committed", id: rolloutId });
    } else {
      this.wal.append({ type: "rollout-aborted", id: rolloutId, reason: outcome.reason });
    }
    return outcome.kind;
  }

  drive(): string[] {
    const aborted = this.rollouts.drive(this.options.clock.now());
    for (const { id, reason } of aborted) {
      this.wal.append({ type: "rollout-aborted", id, reason });
    }
    return aborted.map(({ id }) => id);
  }

  retire(subject: string, version: number): void {
    if (!this.registry.hasSubject(subject)) {
      fail("NO_SUCH_SUBJECT", `unknown subject: ${subject}`);
    }
    if (!this.registry.hasVersion(subject, version)) {
      fail("NO_SUCH_VERSION", `subject ${subject} has no version ${version}`);
    }
    if (this.registry.isRetired(subject, version)) {
      return;
    }
    if (this.registry.currentVersion(subject) === version) {
      fail("RETIRE_CURRENT", `version ${version} is the current version of ${subject}`);
    }
    if (this.consumers.anyoneOn(subject, version)) {
      fail("RETIRE_IN_USE", `consumers still on version ${version} of ${subject}`);
    }
    const pinned = this.rollouts.pinsVersion(subject, version, (target) =>
      this.registry.dependsOn(subject, target, version),
    );
    if (pinned) {
      fail("RETIRE_ACTIVE", `version ${version} of ${subject} is pinned by an active rollout`);
    }
    if (!this.registry.hasCommittedSuccessor(subject, version)) {
      fail("RETIRE_NO_SUCCESSOR", `version ${version} of ${subject} has no committed successor`);
    }
    this.registry.retire(subject, version);
    this.wal.append({ type: "version-retired", subject, version });
  }

  status(rolloutId: string): RolloutStatusInfo {
    return this.rollouts.status(rolloutId);
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
    return {
      subjects: this.registry.subjectCount,
      versions: this.registry.versionCount,
      retiredVersions: this.registry.retiredCount,
      consumers: this.consumers.size,
      rollouts: this.rollouts.total,
      activeRollouts: this.rollouts.activeCount,
      committedRollouts: this.rollouts.committedCount,
      abortedRollouts: this.rollouts.abortedCount,
    };
  }

  journal(): JournalEntry[] {
    return this.wal.snapshot();
  }
}
