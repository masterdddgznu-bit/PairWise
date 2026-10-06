import { fail } from "./errors";
import { Journal } from "./journal";
import { ReservationLedger } from "./reservations";
import { TenantState } from "./tenant";
import { TransferLedger } from "./transfers";
import {
  GlobalView,
  JournalEntry,
  PrepareTransferParams,
  ReservationActionParams,
  ReservationRecord,
  ReserveParams,
  TenantConfig,
  TenantView,
  TransferDecisionParams,
  TransferRecord,
} from "./types";
import {
  requireAmount,
  requireNonEmptyString,
  requirePositive,
  requireSafeInteger,
  requireTimestamp,
} from "./validate";

export class EscrowMesh {
  private readonly capacity: number;
  private allocated = 0;
  private readonly tenants = new Map<string, TenantState>();
  private readonly transferLedger = new TransferLedger();
  private readonly reservationLedger = new ReservationLedger();
  private readonly journalLog = new Journal();
  private replaying = false;

  constructor(capacity: number) {
    this.capacity = requireSafeInteger(capacity, "INVALID_CAPACITY", "capacity");
    if (this.capacity < 0) {
      fail("INVALID_CAPACITY", "capacity must be a non-negative safe integer");
    }
  }

  addTenant(config: TenantConfig, at: number): TenantView {
    requireTimestamp(at);
    const tenant = new TenantState(config);
    if (this.tenants.has(tenant.tenantId)) {
      fail("DUPLICATE_TENANT", `tenant ${tenant.tenantId} already exists`);
    }
    const nextAllocated = this.allocated + tenant.quota;
    if (!Number.isSafeInteger(nextAllocated) || nextAllocated > this.capacity) {
      fail("GLOBAL_CAPACITY", "tenant quotas exceed global capacity");
    }
    this.tenants.set(tenant.tenantId, tenant);
    this.allocated = nextAllocated;
    this.journalLog.append("tenant.added", at, {
      tenantId: tenant.tenantId,
      quota: tenant.quota,
      regions: config.regions.map((split) => ({
        regionId: split.regionId,
        amount: split.amount,
      })),
    });
    return tenant.view();
  }

  prepareTransfer(params: PrepareTransferParams): TransferRecord {
    const at = requireTimestamp(params?.at);
    const tenant = this.requireTenant(params?.tenantId);
    const amount = requireAmount(params?.amount);
    const from = requireNonEmptyString(params?.from, "INVALID_REGION", "from");
    const to = requireNonEmptyString(params?.to, "INVALID_REGION", "to");
    if (from === to) {
      fail("SELF_TRANSFER", "source and destination regions must differ");
    }
    if (!tenant.hasRegion(from)) {
      fail("UNKNOWN_REGION", `tenant ${tenant.tenantId} has no region ${from}`);
    }
    if (!tenant.hasRegion(to)) {
      fail("UNKNOWN_REGION", `tenant ${tenant.tenantId} has no region ${to}`);
    }
    const epoch = requirePositive(params?.epoch, "INVALID_EPOCH", "epoch");
    const nonce = requireNonEmptyString(params?.nonce, "INVALID_NONCE", "nonce");
    return this.transferLedger.prepare(
      tenant,
      { from, to, amount, epoch, nonce, at },
      this.replaying,
      null,
      this.journalLog,
    );
  }

  acceptTransfer(params: TransferDecisionParams): TransferRecord {
    const at = requireTimestamp(params?.at);
    const record = this.requireTransfer(params?.transferId);
    this.assertToken(record, params?.epoch, params?.nonce);
    const tenant = this.requireTenant(record.tenantId);
    return this.transferLedger.accept(record, tenant, at, this.replaying, this.journalLog);
  }

  cancelTransfer(params: TransferDecisionParams): TransferRecord {
    const at = requireTimestamp(params?.at);
    const record = this.requireTransfer(params?.transferId);
    this.assertToken(record, params?.epoch, params?.nonce);
    const tenant = this.requireTenant(record.tenantId);
    return this.transferLedger.cancel(record, tenant, at, this.replaying, this.journalLog);
  }

  reserve(params: ReserveParams): ReservationRecord {
    const at = requireTimestamp(params?.at);
    const tenant = this.requireTenant(params?.tenantId);
    const regionId = requireNonEmptyString(params?.regionId, "INVALID_REGION", "regionId");
    const worker = requireNonEmptyString(params?.worker, "INVALID_IDENTITY", "worker");
    const owner = requireNonEmptyString(params?.owner, "INVALID_IDENTITY", "owner");
    const amount = requireAmount(params?.amount);
    const leaseMs = requirePositive(params?.leaseMs, "INVALID_LEASE", "leaseMs");
    if (!Number.isSafeInteger(at + leaseMs)) {
      fail("INVALID_LEASE", "lease expiry overflows safe integer range");
    }
    return this.reservationLedger.reserve(
      tenant,
      { regionId, worker, owner, amount, leaseMs, at },
      null,
      null,
      this.journalLog,
    );
  }

  commitReservation(params: ReservationActionParams): ReservationRecord {
    const at = requireTimestamp(params?.at);
    const record = this.requireReservation(params?.reservationId);
    const tenant = this.requireTenant(record.tenantId);
    return this.reservationLedger.settle(
      record,
      tenant,
      params?.owner,
      params?.fence,
      at,
      "commit",
      this.journalLog,
    );
  }

  releaseReservation(params: ReservationActionParams): ReservationRecord {
    const at = requireTimestamp(params?.at);
    const record = this.requireReservation(params?.reservationId);
    const tenant = this.requireTenant(record.tenantId);
    return this.reservationLedger.settle(
      record,
      tenant,
      params?.owner,
      params?.fence,
      at,
      "release",
      this.journalLog,
    );
  }

  drive(now: number): string[] {
    requireTimestamp(now);
    const expired = this.reservationLedger.collectExpired(now);
    const ids: string[] = [];
    for (const record of expired) {
      const tenant = this.requireTenant(record.tenantId);
      this.reservationLedger.expire(record, tenant, now, this.journalLog);
      ids.push(record.id);
    }
    return ids;
  }

  tenantView(tenantId: string): TenantView {
    return this.requireTenant(tenantId).view();
  }

  globalView(): GlobalView {
    return {
      capacity: this.capacity,
      allocated: this.allocated,
      remaining: this.capacity - this.allocated,
    };
  }

  transferView(transferId: string): TransferRecord | null {
    return this.transferLedger.view(transferId);
  }

  reservationView(reservationId: string): ReservationRecord | null {
    return this.reservationLedger.view(reservationId);
  }

  journal(): JournalEntry[] {
    return this.journalLog.list();
  }

  static fromJournal(
    capacity: number,
    entries: JournalEntry[],
    recoveryNow: number,
  ): EscrowMesh {
    requireTimestamp(recoveryNow);
    if (!Array.isArray(entries)) {
      fail("INVALID_JOURNAL", "journal entries must be an array");
    }
    const mesh = new EscrowMesh(capacity);
    mesh.replaying = true;
    mesh.journalLog.suspend();
    try {
      entries.forEach((entry, index) => {
        mesh.replayEntry(entry, index + 1, recoveryNow);
      });
    } finally {
      mesh.journalLog.resume();
      mesh.replaying = false;
    }
    return mesh;
  }

  private replayEntry(raw: JournalEntry, expectedSeq: number, recoveryNow: number): void {
    if (typeof raw !== "object" || raw === null) {
      fail("INVALID_JOURNAL", "journal entry must be an object");
    }
    const { seq, at, kind, data } = raw;
    if (!Number.isSafeInteger(seq) || seq !== expectedSeq) {
      fail("JOURNAL_GAP", `expected journal seq ${expectedSeq}, found ${String(seq)}`);
    }
    if (!Number.isSafeInteger(at)) {
      fail("INVALID_TIME", "journal entry time must be a safe integer");
    }
    if (at > recoveryNow) {
      fail("FUTURE_JOURNAL", `journal entry at ${at} is ahead of recovery time ${recoveryNow}`);
    }
    if (typeof data !== "object" || data === null) {
      fail("INVALID_JOURNAL", "journal entry data must be an object");
    }
    switch (kind) {
      case "tenant.added":
        this.addTenant(data as unknown as TenantConfig, at);
        break;
      case "transfer.prepared":
        this.replayTransferPrepared(data, at);
        break;
      case "transfer.accepted":
        this.acceptTransfer({
          transferId: data.transferId as string,
          epoch: data.epoch as number,
          nonce: data.nonce as string,
          at,
        });
        break;
      case "transfer.cancelled":
        this.cancelTransfer({
          transferId: data.transferId as string,
          epoch: data.epoch as number,
          nonce: data.nonce as string,
          at,
        });
        break;
      case "reservation.reserved":
        this.replayReservationReserved(data, at);
        break;
      case "reservation.committed":
        this.commitReservation({
          reservationId: data.reservationId as string,
          owner: data.owner as string,
          fence: data.fence as number,
          at,
        });
        break;
      case "reservation.released":
        this.releaseReservation({
          reservationId: data.reservationId as string,
          owner: data.owner as string,
          fence: data.fence as number,
          at,
        });
        break;
      case "reservation.expired": {
        const record = this.requireReservation(data.reservationId as string);
        const tenant = this.requireTenant(record.tenantId);
        this.reservationLedger.expire(record, tenant, at, this.journalLog);
        break;
      }
      default:
        fail("UNKNOWN_JOURNAL_KIND", `unknown journal kind ${String(kind)}`);
    }
    this.journalLog.appendRecovered(raw);
  }

  private replayTransferPrepared(data: Record<string, unknown>, at: number): void {
    const tenant = this.requireTenant(data.tenantId);
    const amount = requireAmount(data.amount);
    const from = requireNonEmptyString(data.from, "INVALID_REGION", "from");
    const to = requireNonEmptyString(data.to, "INVALID_REGION", "to");
    if (from === to) {
      fail("SELF_TRANSFER", "source and destination regions must differ");
    }
    if (!tenant.hasRegion(from) || !tenant.hasRegion(to)) {
      fail("UNKNOWN_REGION", "journal transfer references an unknown region");
    }
    const epoch = requirePositive(data.epoch, "INVALID_EPOCH", "epoch");
    const nonce = requireNonEmptyString(data.nonce, "INVALID_NONCE", "nonce");
    const expectedId = requireNonEmptyString(data.transferId, "JOURNAL_MISMATCH", "transferId");
    this.transferLedger.prepare(
      tenant,
      { from, to, amount, epoch, nonce, at },
      true,
      expectedId,
      this.journalLog,
    );
  }

  private replayReservationReserved(data: Record<string, unknown>, at: number): void {
    const tenant = this.requireTenant(data.tenantId);
    const regionId = requireNonEmptyString(data.regionId, "INVALID_REGION", "regionId");
    const worker = requireNonEmptyString(data.worker, "INVALID_IDENTITY", "worker");
    const owner = requireNonEmptyString(data.owner, "INVALID_IDENTITY", "owner");
    const amount = requireAmount(data.amount);
    const leaseMs = requirePositive(data.leaseMs, "INVALID_LEASE", "leaseMs");
    if (!Number.isSafeInteger(at + leaseMs)) {
      fail("INVALID_LEASE", "lease expiry overflows safe integer range");
    }
    const expectedId = requireNonEmptyString(
      data.reservationId,
      "JOURNAL_MISMATCH",
      "reservationId",
    );
    const expectedFence = requireSafeInteger(data.fence, "JOURNAL_MISMATCH", "fence");
    this.reservationLedger.reserve(
      tenant,
      { regionId, worker, owner, amount, leaseMs, at },
      expectedId,
      expectedFence,
      this.journalLog,
    );
  }

  private requireTenant(tenantId: unknown): TenantState {
    const tenant =
      typeof tenantId === "string" ? this.tenants.get(tenantId) : undefined;
    if (!tenant) {
      fail("UNKNOWN_TENANT", `unknown tenant ${String(tenantId)}`);
    }
    return tenant;
  }

  private requireTransfer(transferId: unknown): TransferRecord {
    const record =
      typeof transferId === "string" ? this.transferLedger.get(transferId) : undefined;
    if (!record) {
      fail("UNKNOWN_TRANSFER", `unknown transfer ${String(transferId)}`);
    }
    return record;
  }

  private requireReservation(reservationId: unknown): ReservationRecord {
    const record =
      typeof reservationId === "string"
        ? this.reservationLedger.get(reservationId)
        : undefined;
    if (!record) {
      fail("UNKNOWN_RESERVATION", `unknown reservation ${String(reservationId)}`);
    }
    return record;
  }

  private assertToken(record: TransferRecord, epoch: unknown, nonce: unknown): void {
    if (record.epoch !== epoch || record.nonce !== nonce) {
      fail("TRANSFER_TOKEN", `epoch/nonce token does not match transfer ${record.id}`);
    }
  }
}
