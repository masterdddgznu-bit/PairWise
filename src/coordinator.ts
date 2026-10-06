import { AnchorStore } from "./anchors";
import { CertificateStore, CertRecord } from "./certificates";
import { ManualClock } from "./clock";
import { TrustRollError } from "./errors";
import { ObligationStore } from "./obligations";
import { RevocationStore } from "./revocations";
import {
  Bundle,
  Claim,
  JournalEntry,
  Limits,
  StateSnapshot,
  TenantView,
  WalPayload,
} from "./types";
import { Wal } from "./wal";

interface RequiredLimits {
  certificates: number;
  obligations: number;
  wal: number;
}

export class TrustRollCoordinator {
  private readonly clock: ManualClock;
  private readonly limits: RequiredLimits;
  private readonly anchors = new AnchorStore();
  private readonly certificates = new CertificateStore();
  private readonly obligations = new ObligationStore();
  private readonly revocations = new RevocationStore();
  private readonly wal = new Wal();

  constructor(clock: ManualClock, limits: Limits = {}) {
    this.clock = clock;
    this.limits = {
      certificates: limits.certificates ?? Number.POSITIVE_INFINITY,
      obligations: limits.obligations ?? Number.POSITIVE_INFINITY,
      wal: limits.wal ?? Number.POSITIVE_INFINITY,
    };
  }

  static fromJournal(
    clock: ManualClock,
    journal: JournalEntry[],
    limits: Limits = {},
  ): TrustRollCoordinator {
    const coordinator = new TrustRollCoordinator(clock, limits);
    let expectedSeq = 1;
    let lastAt = Number.NEGATIVE_INFINITY;
    for (const entry of journal) {
      if (entry.seq !== expectedSeq) {
        throw new TrustRollError(
          "JOURNAL_GAP",
          `journal sequence gap: expected ${expectedSeq}, got ${entry.seq}`,
        );
      }
      if (entry.at > clock.now() || entry.at < lastAt) {
        throw new TrustRollError(
          "JOURNAL_TIME",
          `journal entry at ${entry.at} is outside the replayable time window`,
        );
      }
      TrustRollCoordinator.validateSnapshot(entry.state);
      expectedSeq += 1;
      lastAt = entry.at;
    }
    if (journal.length > 0) {
      coordinator.restore(journal[journal.length - 1].state);
      coordinator.wal.load(journal);
    }
    return coordinator;
  }

  registerTenant(tenant: string, generation: number, cohorts: string[]): void {
    if (this.anchors.has(tenant)) {
      throw new TrustRollError("TENANT_EXISTS", `tenant already registered: ${tenant}`);
    }
    this.preflightWal(1);
    this.anchors.register(tenant, generation, cohorts);
    this.commit({ op: "register-tenant", tenant, generation, cohorts: [...cohorts] });
  }

  setCohorts(tenant: string, cohorts: string[]): void {
    const anchor = this.anchors.require(tenant);
    if (anchor.rotation !== null) {
      throw new TrustRollError("ROTATION_ACTIVE", `rotation active for tenant ${tenant}`);
    }
    this.preflightWal(1);
    this.anchors.setCohorts(tenant, cohorts);
    this.commit({ op: "set-cohorts", tenant, cohorts: [...cohorts] });
  }

  issueCertificate(
    tenant: string,
    identity: string,
    serial: string,
    expiresAt: number,
  ): void {
    const anchor = this.anchors.require(tenant);
    const owner = this.certificates.identityOwner(identity);
    if (owner !== undefined && owner !== tenant) {
      throw new TrustRollError(
        "CROSS_TENANT_IDENTITY",
        `identity ${identity} is owned by tenant ${owner}`,
      );
    }
    if (this.certificates.has(tenant, serial)) {
      throw new TrustRollError(
        "SERIAL_EXISTS",
        `serial ${serial} already exists for tenant ${tenant}`,
      );
    }
    if (this.certificates.countAll() + 1 > this.limits.certificates) {
      throw new TrustRollError("CAPACITY_CERTIFICATES", "certificate capacity reached");
    }
    this.preflightWal(1);
    this.certificates.issue(tenant, {
      serial,
      identity,
      anchorGeneration: anchor.issuance,
      issuedAt: this.clock.now(),
      expiresAt,
      revoked: false,
      replaces: null,
      replacedBy: null,
    });
    this.commit({ op: "issue-certificate", tenant, identity, serial, expiresAt });
  }

  beginRotation(tenant: string, target: number): number {
    const anchor = this.anchors.require(tenant);
    if (anchor.rotation !== null) {
      throw new TrustRollError("ROTATION_ACTIVE", `rotation active for tenant ${tenant}`);
    }
    if (target <= anchor.issuance) {
      throw new TrustRollError(
        "ANCHOR_REGRESSION",
        `target generation ${target} does not advance issuance ${anchor.issuance}`,
      );
    }
    const sources = this.certificates.liveSourceSerials(tenant, target, this.clock.now());
    if (this.obligations.openCount() + sources.length > this.limits.obligations) {
      throw new TrustRollError("CAPACITY_OBLIGATIONS", "obligation capacity reached");
    }
    this.preflightWal(1);
    const revision = this.anchors.beginRotation(tenant, target);
    const obligationIds = this.obligations.createMany(tenant, sources);
    this.commit({ op: "begin-rotation", tenant, target, revision, obligations: obligationIds });
    return revision;
  }

  acknowledge(tenant: string, cohort: string, revision: number): boolean {
    const anchor = this.anchors.require(tenant);
    const rotation = anchor.rotation;
    if (rotation === null) {
      throw new TrustRollError("NO_ACTIVE_ROTATION", `no active rotation for tenant ${tenant}`);
    }
    if (revision < rotation.revision) {
      throw new TrustRollError(
        "ACK_REGRESSION",
        `ack revision ${revision} regresses current revision ${rotation.revision}`,
      );
    }
    if (revision > rotation.revision) {
      throw new TrustRollError("UNKNOWN_REVISION", `unknown revision ${revision}`);
    }
    if (!rotation.requiredCohorts.includes(cohort)) {
      throw new TrustRollError("UNKNOWN_COHORT", `cohort ${cohort} is not required`);
    }
    if (rotation.acknowledged.includes(cohort)) {
      return false;
    }
    this.preflightWal(1);
    rotation.acknowledged.push(cohort);
    this.commit({ op: "acknowledge", tenant, cohort, revision });
    return true;
  }

  bundle(tenant: string, revision: number): Bundle {
    const anchor = this.anchors.require(tenant);
    const rotation = anchor.rotation;
    if (rotation === null || rotation.revision !== revision) {
      throw new TrustRollError("UNKNOWN_REVISION", `unknown revision ${revision}`);
    }
    return { revision, generations: [...anchor.trusted] };
  }

  claim(tenant: string, agent: string, ttl: number): Claim | null {
    this.anchors.require(tenant);
    const record = this.obligations.nextPending(tenant);
    if (!record) {
      return null;
    }
    this.preflightWal(1);
    this.obligations.lease(record, agent, ttl, this.clock.now());
    this.commit({
      op: "claim",
      tenant,
      obligationId: record.id,
      agent,
      fence: record.fence,
      leaseExpiresAt: record.leaseExpiresAt,
    });
    return {
      obligationId: record.id,
      tenant,
      sourceSerial: record.sourceSerial,
      agent,
      fence: record.fence,
      leaseExpiresAt: record.leaseExpiresAt!,
    };
  }

  complete(
    tenant: string,
    obligationId: string,
    agent: string,
    fence: number,
    newSerial: string,
    expiresAt: number,
  ): void {
    const anchor = this.anchors.require(tenant);
    const record = this.obligations.get(tenant, obligationId);
    if (!record) {
      throw new TrustRollError("UNKNOWN_OBLIGATION", `unknown obligation ${obligationId}`);
    }
    if (record.state !== "leased" || record.claimant !== agent || record.fence !== fence) {
      throw new TrustRollError("STALE_CLAIM", `stale claim for obligation ${obligationId}`);
    }
    if (record.leaseExpiresAt === null || this.clock.now() >= record.leaseExpiresAt) {
      throw new TrustRollError("LEASE_EXPIRED", `lease expired for obligation ${obligationId}`);
    }
    if (!this.anchors.barrierSatisfied(tenant)) {
      throw new TrustRollError("BUNDLE_BARRIER", "trust distribution barrier not satisfied");
    }
    const source = this.certificates.get(tenant, record.sourceSerial);
    if (!source || source.replacedBy !== null || source.revoked) {
      throw new TrustRollError(
        "LINEAGE_CONFLICT",
        `source certificate ${record.sourceSerial} is no longer current`,
      );
    }
    if (this.certificates.has(tenant, newSerial)) {
      throw new TrustRollError(
        "SERIAL_EXISTS",
        `serial ${newSerial} already exists for tenant ${tenant}`,
      );
    }
    if (this.certificates.countAll() + 1 > this.limits.certificates) {
      throw new TrustRollError("CAPACITY_CERTIFICATES", "certificate capacity reached");
    }
    this.preflightWal(1);
    const replacement: CertRecord = {
      serial: newSerial,
      identity: source.identity,
      anchorGeneration: anchor.issuance,
      issuedAt: this.clock.now(),
      expiresAt,
      revoked: false,
      replaces: source.serial,
      replacedBy: null,
    };
    source.replacedBy = newSerial;
    this.certificates.issue(tenant, replacement);
    this.obligations.markCompleted(record);
    this.commit({
      op: "complete",
      tenant,
      obligationId,
      sourceSerial: source.serial,
      newSerial,
      expiresAt,
    });
  }

  revoke(tenant: string, serial: string): boolean {
    this.anchors.require(tenant);
    const cert = this.certificates.get(tenant, serial);
    if (!cert) {
      throw new TrustRollError("UNKNOWN_CERTIFICATE", `unknown certificate ${serial}`);
    }
    if (cert.revoked) {
      return false;
    }
    this.preflightWal(1);
    cert.revoked = true;
    this.revocations.add(tenant, serial);
    const cancelled = this.obligations.cancelForSource(tenant, serial);
    this.commit({ op: "revoke", tenant, serial, cancelled });
    return true;
  }

  publishRevocations(tenant: string): number {
    this.anchors.require(tenant);
    const pending = this.revocations.unpublished(tenant);
    if (pending.length === 0) {
      return 0;
    }
    this.preflightWal(1);
    const published = this.revocations.publish(tenant);
    this.commit({ op: "publish-revocations", tenant, serials: published });
    return published.length;
  }

  retireOldAnchor(tenant: string): number {
    const anchor = this.anchors.require(tenant);
    if (anchor.rotation === null) {
      throw new TrustRollError("NO_ACTIVE_ROTATION", `no active rotation for tenant ${tenant}`);
    }
    if (!this.anchors.barrierSatisfied(tenant)) {
      throw new TrustRollError("BUNDLE_BARRIER", "trust distribution barrier not satisfied");
    }
    if (this.certificates.hasLiveOldLineage(tenant, anchor.issuance, this.clock.now())) {
      throw new TrustRollError(
        "LIVE_OLD_CERTIFICATE",
        "live lineage still depends on the old anchor",
      );
    }
    if (this.obligations.openCount(tenant) > 0) {
      throw new TrustRollError("OPEN_OBLIGATIONS", "open re-sign obligations remain");
    }
    if (this.revocations.unpublished(tenant).length > 0) {
      throw new TrustRollError("UNPUBLISHED_REVOCATION", "unpublished revocations remain");
    }
    this.preflightWal(1);
    const removed = this.anchors.retireOld(tenant);
    this.commit({ op: "retire-anchor", tenant, removed });
    return removed.length;
  }

  drive(): number {
    const expired = this.obligations.expiredLeases(this.clock.now());
    if (expired.length === 0) {
      return 0;
    }
    this.preflightWal(1);
    this.obligations.requeue(expired);
    this.commit({ op: "drive", requeued: expired.map((ob) => ob.id) });
    return expired.length;
  }

  view(tenant: string): TenantView {
    const anchor = this.anchors.require(tenant);
    return {
      trustedGenerations: [...anchor.trusted],
      issuanceGeneration: anchor.issuance,
      rotation:
        anchor.rotation === null
          ? null
          : {
              target: anchor.rotation.target,
              revision: anchor.rotation.revision,
              requiredCohorts: [...anchor.rotation.requiredCohorts],
              acknowledged: [...anchor.rotation.acknowledged],
            },
      certificates: this.certificates.list(tenant).map((cert) => ({ ...cert })),
      obligations: this.obligations.list(tenant).map((ob) => ({
        obligationId: ob.id,
        sourceSerial: ob.sourceSerial,
        state: ob.state,
        claimant: ob.claimant,
        fence: ob.fence,
        leaseExpiresAt: ob.leaseExpiresAt,
      })),
    };
  }

  journal(): JournalEntry[] {
    return this.wal.list();
  }

  private preflightWal(entries: number): void {
    if (this.wal.length + entries > this.limits.wal) {
      throw new TrustRollError("CAPACITY_WAL", "write-ahead log capacity reached");
    }
  }

  private commit(payload: WalPayload): void {
    this.wal.append(this.clock.now(), payload, this.snapshot());
  }

  private snapshot(): StateSnapshot {
    return {
      anchors: this.anchors.snapshot(),
      certificates: this.certificates.snapshot(),
      obligations: this.obligations.snapshot(),
      revocations: this.revocations.snapshot(),
    };
  }

  private restore(snapshot: StateSnapshot): void {
    this.anchors.restore(snapshot.anchors);
    this.certificates.restore(snapshot.certificates);
    this.obligations.restore(snapshot.obligations);
    this.revocations.restore(snapshot.revocations);
  }

  private static validateSnapshot(state: StateSnapshot): void {
    AnchorStore.validate(state.anchors);
    CertificateStore.validate(state.certificates);
    const serials = new Map<string, Set<string>>();
    for (const [tenant, entries] of state.certificates.tenants) {
      serials.set(tenant, new Set(entries.map(([serial]) => serial)));
    }
    for (const [tenant, list] of state.obligations.tenants) {
      const owned = serials.get(tenant);
      for (const ob of list) {
        if (!owned || !owned.has(ob.sourceSerial)) {
          throw new TrustRollError(
            "JOURNAL_LINEAGE",
            `obligation ${ob.id} references unknown certificate ${ob.sourceSerial}`,
          );
        }
      }
    }
    for (const [tenant, revocation] of state.revocations) {
      const owned = serials.get(tenant);
      for (const serial of [...revocation.unpublished, ...revocation.published]) {
        if (!owned || !owned.has(serial)) {
          throw new TrustRollError(
            "JOURNAL_LINEAGE",
            `revocation references unknown certificate ${serial}`,
          );
        }
      }
    }
  }
}
