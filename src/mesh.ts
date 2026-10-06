import { EscrowError } from "./errors";
import { appendEntry, snapshot, validateEntry } from "./journal";
import {
  collectExpired,
  commitReservation as commitReservationOp,
  createReservationStore,
  expireReservation,
  releaseReservation as releaseReservationOp,
  reserve as reserveOp,
  type ReservationState,
  type ReservationStore,
} from "./reservations";
import { availableOf, buildTenant, requireRegion, type TenantState } from "./tenants";
import {
  acceptTransfer as acceptTransferOp,
  cancelTransfer as cancelTransferOp,
  createTransferStore,
  prepareTransfer as prepareTransferOp,
  type TransferState,
  type TransferStore,
} from "./transfers";
import type {
  GlobalView,
  JournalEntry,
  Mode,
  PrepareTransferParams,
  RegionAllocation,
  ReservationActionParams,
  ReservationView,
  ReserveParams,
  TenantConfig,
  TenantView,
  TransferTokenParams,
  TransferView,
} from "./types";
import { assertNonNegativeInt, assertPositiveInt, assertSafeSum } from "./validate";

function toTransferView(transfer: TransferState): TransferView {
  return {
    id: transfer.id,
    tenantId: transfer.tenantId,
    from: transfer.from,
    to: transfer.to,
    amount: transfer.amount,
    epoch: transfer.epoch,
    nonce: transfer.nonce,
    phase: transfer.phase,
  };
}

function toReservationView(reservation: ReservationState): ReservationView {
  return {
    id: reservation.id,
    tenantId: reservation.tenantId,
    regionId: reservation.regionId,
    worker: reservation.worker,
    owner: reservation.owner,
    amount: reservation.amount,
    fence: reservation.fence,
    createdAt: reservation.createdAt,
    expiresAt: reservation.expiresAt,
    phase: reservation.phase,
  };
}

export class EscrowMesh {
  private readonly capacity: number;
  private allocated = 0;
  private readonly tenants = new Map<string, TenantState>();
  private readonly transfers: TransferStore = createTransferStore();
  private readonly reservations: ReservationStore = createReservationStore();
  private readonly wal: JournalEntry[] = [];

  constructor(capacity: number) {
    assertNonNegativeInt(capacity, "INVALID_CAPACITY", "capacity");
    this.capacity = capacity;
  }

  static fromJournal(capacity: number, entries: JournalEntry[], recoveryNow: number): EscrowMesh {
    assertNonNegativeInt(recoveryNow, "INVALID_TIME", "recoveryNow");
    if (!Array.isArray(entries)) {
      throw new EscrowError("JOURNAL_INVALID", "journal entries must be an array");
    }
    const mesh = new EscrowMesh(capacity);
    entries.forEach((raw, index) => {
      const entry = validateEntry(raw, index + 1, recoveryNow);
      mesh.replay(entry);
      mesh.wal.push(entry);
    });
    return mesh;
  }

  addTenant(config: TenantConfig, at: number): TenantView {
    assertNonNegativeInt(at, "INVALID_TIME", "at");
    const tenant = this.execAddTenant(config, "live");
    this.recordTenantAdded(tenant, at);
    return this.tenantView(tenant.tenantId);
  }

  prepareTransfer(params: PrepareTransferParams): TransferView {
    assertNonNegativeInt(params?.at, "INVALID_TIME", "at");
    const { transfer, created } = this.execPrepare(params, "live");
    if (created) {
      appendEntry(this.wal, "transfer.prepared", params.at, {
        transferId: transfer.id,
        tenantId: transfer.tenantId,
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        epoch: transfer.epoch,
        nonce: transfer.nonce,
      });
    }
    return toTransferView(transfer);
  }

  acceptTransfer(params: TransferTokenParams): TransferView {
    assertNonNegativeInt(params?.at, "INVALID_TIME", "at");
    const { transfer, changed } = this.execAccept(params, "live");
    if (changed) {
      appendEntry(this.wal, "transfer.accepted", params.at, {
        transferId: transfer.id,
        epoch: transfer.epoch,
        nonce: transfer.nonce,
      });
    }
    return toTransferView(transfer);
  }

  cancelTransfer(params: TransferTokenParams): TransferView {
    assertNonNegativeInt(params?.at, "INVALID_TIME", "at");
    const { transfer, changed } = this.execCancel(params, "live");
    if (changed) {
      appendEntry(this.wal, "transfer.cancelled", params.at, {
        transferId: transfer.id,
        epoch: transfer.epoch,
        nonce: transfer.nonce,
      });
    }
    return toTransferView(transfer);
  }

  reserve(params: ReserveParams): ReservationView {
    assertNonNegativeInt(params?.at, "INVALID_TIME", "at");
    const reservation = this.execReserve(params, "live");
    appendEntry(this.wal, "reservation.reserved", params.at, {
      reservationId: reservation.id,
      tenantId: reservation.tenantId,
      regionId: reservation.regionId,
      worker: reservation.worker,
      owner: reservation.owner,
      amount: reservation.amount,
      fence: reservation.fence,
      leaseMs: params.leaseMs,
      expiresAt: reservation.expiresAt,
    });
    return toReservationView(reservation);
  }

  commitReservation(params: ReservationActionParams): ReservationView {
    assertNonNegativeInt(params?.at, "INVALID_TIME", "at");
    const reservation = this.execCommit(params, "live");
    appendEntry(this.wal, "reservation.committed", params.at, {
      reservationId: reservation.id,
      owner: reservation.owner,
      fence: reservation.fence,
    });
    return toReservationView(reservation);
  }

  releaseReservation(params: ReservationActionParams): ReservationView {
    assertNonNegativeInt(params?.at, "INVALID_TIME", "at");
    const reservation = this.execRelease(params, "live");
    appendEntry(this.wal, "reservation.released", params.at, {
      reservationId: reservation.id,
      owner: reservation.owner,
      fence: reservation.fence,
    });
    return toReservationView(reservation);
  }

  drive(now: number): string[] {
    assertNonNegativeInt(now, "INVALID_TIME", "now");
    const released: string[] = [];
    for (const reservation of collectExpired(this.reservations, now)) {
      const tenant = this.requireTenant(reservation.tenantId);
      expireReservation(this.reservations, tenant, reservation, now, "live");
      appendEntry(this.wal, "reservation.expired", now, { reservationId: reservation.id });
      released.push(reservation.id);
    }
    return released;
  }

  tenantView(tenantId: string): TenantView {
    const tenant = this.requireTenant(tenantId);
    const availableByRegion: Record<string, number> = {};
    const reservedByRegion: Record<string, number> = {};
    const lockedByRegion: Record<string, number> = {};
    for (const [regionId, region] of tenant.regions) {
      availableByRegion[regionId] = availableOf(region);
      reservedByRegion[regionId] = region.reserved;
      lockedByRegion[regionId] = region.locked;
    }
    return {
      tenantId: tenant.tenantId,
      configuredQuota: tenant.quota,
      consumed: tenant.consumed,
      availableByRegion,
      reservedByRegion,
      lockedByRegion,
    };
  }

  globalView(): GlobalView {
    return {
      capacity: this.capacity,
      allocated: this.allocated,
      remaining: this.capacity - this.allocated,
    };
  }

  transferView(transferId: string): TransferView | null {
    const transfer = this.transfers.byId.get(transferId);
    return transfer ? toTransferView(transfer) : null;
  }

  reservationView(reservationId: string): ReservationView | null {
    const reservation = this.reservations.byId.get(reservationId);
    return reservation ? toReservationView(reservation) : null;
  }

  journal(): JournalEntry[] {
    return snapshot(this.wal);
  }

  private requireTenant(tenantId: string): TenantState {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new EscrowError("UNKNOWN_TENANT", `unknown tenant ${String(tenantId)}`);
    }
    return tenant;
  }

  private execAddTenant(config: TenantConfig, mode: Mode): TenantState {
    const tenant = buildTenant(config);
    if (this.tenants.has(tenant.tenantId)) {
      throw new EscrowError(
        mode === "replay" ? "DUPLICATE_MUTATION" : "TENANT_EXISTS",
        `tenant ${tenant.tenantId} already exists`,
      );
    }
    const allocated = this.allocated + tenant.quota;
    assertSafeSum(allocated, "GLOBAL_CAPACITY", "allocated quota");
    if (allocated > this.capacity) {
      throw new EscrowError("GLOBAL_CAPACITY", `quota ${tenant.quota} exceeds remaining global capacity`);
    }
    this.tenants.set(tenant.tenantId, tenant);
    this.allocated = allocated;
    return tenant;
  }

  private recordTenantAdded(tenant: TenantState, at: number): void {
    const regions: RegionAllocation[] = [];
    for (const [regionId, region] of tenant.regions) {
      regions.push({ regionId, amount: region.rights });
    }
    appendEntry(this.wal, "tenant.added", at, { tenantId: tenant.tenantId, quota: tenant.quota, regions });
  }

  private execPrepare(
    params: PrepareTransferParams,
    mode: Mode,
    replayId?: string,
  ): { transfer: TransferState; created: boolean } {
    assertPositiveInt(params?.amount, "INVALID_AMOUNT", "amount");
    assertPositiveInt(params?.epoch, "INVALID_EPOCH", "epoch");
    if (params.from === params.to) {
      throw new EscrowError("SELF_TRANSFER", "transfer source and destination must differ");
    }
    const tenant = this.requireTenant(params.tenantId);
    requireRegion(tenant, params.from);
    requireRegion(tenant, params.to);
    return prepareTransferOp(this.transfers, tenant, params, mode, replayId);
  }

  private requireTransfer(token: TransferTokenParams): { tenant: TenantState; transfer: TransferState } {
    const transfer = this.transfers.byId.get(token?.transferId);
    if (!transfer) {
      throw new EscrowError("UNKNOWN_TRANSFER", `unknown transfer ${String(token?.transferId)}`);
    }
    if (transfer.epoch !== token.epoch || transfer.nonce !== token.nonce) {
      throw new EscrowError("TRANSFER_TOKEN", `epoch/nonce mismatch for transfer ${transfer.id}`);
    }
    return { tenant: this.requireTenant(transfer.tenantId), transfer };
  }

  private execAccept(token: TransferTokenParams, mode: Mode): { transfer: TransferState; changed: boolean } {
    const { tenant, transfer } = this.requireTransfer(token);
    const changed = acceptTransferOp(this.transfers, tenant, transfer, mode);
    return { transfer, changed };
  }

  private execCancel(token: TransferTokenParams, mode: Mode): { transfer: TransferState; changed: boolean } {
    const { tenant, transfer } = this.requireTransfer(token);
    const changed = cancelTransferOp(this.transfers, tenant, transfer, mode);
    return { transfer, changed };
  }

  private execReserve(params: ReserveParams, mode: Mode, replay?: { id: unknown; fence: unknown; expiresAt: unknown }): ReservationState {
    assertPositiveInt(params?.amount, "INVALID_AMOUNT", "amount");
    assertPositiveInt(params?.leaseMs, "INVALID_TIME", "leaseMs");
    const expiresAt = params.at + params.leaseMs;
    assertSafeSum(expiresAt, "INVALID_TIME", "expiresAt");
    const tenant = this.requireTenant(params.tenantId);
    requireRegion(tenant, params.regionId);
    return reserveOp(this.reservations, tenant, params, expiresAt, mode, replay);
  }

  private requireReservation(params: ReservationActionParams): { tenant: TenantState; reservation: ReservationState } {
    const reservation = this.reservations.byId.get(params?.reservationId);
    if (!reservation) {
      throw new EscrowError("UNKNOWN_RESERVATION", `unknown reservation ${String(params?.reservationId)}`);
    }
    if (reservation.owner !== params.owner) {
      throw new EscrowError("STALE_OWNER", `owner mismatch for reservation ${reservation.id}`);
    }
    if (reservation.fence !== params.fence) {
      throw new EscrowError("STALE_FENCE", `fence mismatch for reservation ${reservation.id}`);
    }
    return { tenant: this.requireTenant(reservation.tenantId), reservation };
  }

  private execCommit(params: ReservationActionParams, mode: Mode): ReservationState {
    const { tenant, reservation } = this.requireReservation(params);
    commitReservationOp(this.reservations, tenant, reservation, params.at, mode);
    return reservation;
  }

  private execRelease(params: ReservationActionParams, mode: Mode): ReservationState {
    const { tenant, reservation } = this.requireReservation(params);
    releaseReservationOp(this.reservations, tenant, reservation, params.at, mode);
    return reservation;
  }

  private replay(entry: JournalEntry): void {
    const data = entry.data;
    switch (entry.kind) {
      case "tenant.added": {
        const config: TenantConfig = {
          tenantId: data.tenantId as string,
          quota: data.quota as number,
          regions: data.regions as RegionAllocation[],
        };
        this.execAddTenant(config, "replay");
        break;
      }
      case "transfer.prepared": {
        this.execPrepare(
          {
            tenantId: data.tenantId as string,
            from: data.from as string,
            to: data.to as string,
            amount: data.amount as number,
            epoch: data.epoch as number,
            nonce: data.nonce as string,
            at: entry.at,
          },
          "replay",
          data.transferId as string,
        );
        break;
      }
      case "transfer.accepted": {
        this.execAccept(
          { transferId: data.transferId as string, epoch: data.epoch as number, nonce: data.nonce as string, at: entry.at },
          "replay",
        );
        break;
      }
      case "transfer.cancelled": {
        this.execCancel(
          { transferId: data.transferId as string, epoch: data.epoch as number, nonce: data.nonce as string, at: entry.at },
          "replay",
        );
        break;
      }
      case "reservation.reserved": {
        this.execReserve(
          {
            tenantId: data.tenantId as string,
            regionId: data.regionId as string,
            worker: data.worker as string,
            owner: data.owner as string,
            amount: data.amount as number,
            leaseMs: data.leaseMs as number,
            at: entry.at,
          },
          "replay",
          { id: data.reservationId, fence: data.fence, expiresAt: data.expiresAt },
        );
        break;
      }
      case "reservation.committed": {
        this.execCommit(
          { reservationId: data.reservationId as string, owner: data.owner as string, fence: data.fence as number, at: entry.at },
          "replay",
        );
        break;
      }
      case "reservation.released": {
        this.execRelease(
          { reservationId: data.reservationId as string, owner: data.owner as string, fence: data.fence as number, at: entry.at },
          "replay",
        );
        break;
      }
      case "reservation.expired": {
        const reservation = this.reservations.byId.get(data.reservationId as string);
        if (!reservation) {
          throw new EscrowError("UNKNOWN_RESERVATION", `unknown reservation ${String(data.reservationId)}`);
        }
        const tenant = this.requireTenant(reservation.tenantId);
        expireReservation(this.reservations, tenant, reservation, entry.at, "replay");
        break;
      }
    }
  }
}
