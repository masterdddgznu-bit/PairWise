import { fail } from "./errors";
import { Journal } from "./journal";
import { TenantState } from "./tenant";
import { ReservationRecord } from "./types";

export interface ReserveRequest {
  regionId: string;
  worker: string;
  owner: string;
  amount: number;
  leaseMs: number;
  at: number;
}

export class ReservationLedger {
  private readonly records = new Map<string, ReservationRecord>();
  private readonly fences = new Map<string, number>();
  private counter = 0;

  get(id: string): ReservationRecord | undefined {
    return this.records.get(id);
  }

  view(id: string): ReservationRecord | null {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  reserve(
    tenant: TenantState,
    request: ReserveRequest,
    expectedId: string | null,
    expectedFence: number | null,
    journal: Journal,
  ): ReservationRecord {
    tenant.assertLocalCapacity(request.regionId, request.amount);
    const id = `r${++this.counter}`;
    if (expectedId !== null && expectedId !== id) {
      fail("JOURNAL_MISMATCH", `journal reservation id ${expectedId} does not match next id ${id}`);
    }
    const fenceKey = `${tenant.tenantId} ${request.regionId} ${request.worker}`;
    const fence = (this.fences.get(fenceKey) ?? 0) + 1;
    if (expectedFence !== null && expectedFence !== fence) {
      fail("JOURNAL_MISMATCH", `journal fence ${expectedFence} does not match next fence ${fence}`);
    }
    this.fences.set(fenceKey, fence);
    tenant.applyReserve(request.regionId, request.amount);
    const record: ReservationRecord = {
      id,
      tenantId: tenant.tenantId,
      regionId: request.regionId,
      worker: request.worker,
      owner: request.owner,
      amount: request.amount,
      fence,
      reservedAt: request.at,
      expiresAt: request.at + request.leaseMs,
      phase: "active",
    };
    this.records.set(id, record);
    journal.append("reservation.reserved", request.at, {
      reservationId: id,
      tenantId: record.tenantId,
      regionId: record.regionId,
      worker: record.worker,
      owner: record.owner,
      amount: record.amount,
      fence: record.fence,
      leaseMs: request.leaseMs,
    });
    return { ...record };
  }

  settle(
    record: ReservationRecord,
    tenant: TenantState,
    owner: unknown,
    fence: unknown,
    at: number,
    action: "commit" | "release",
    journal: Journal,
  ): ReservationRecord {
    if (record.owner !== owner) {
      fail("STALE_OWNER", `reservation ${record.id} is owned by ${record.owner}`);
    }
    if (record.fence !== fence) {
      fail("STALE_FENCE", `reservation ${record.id} expects fence ${record.fence}`);
    }
    if (record.phase !== "active") {
      fail("RESERVATION_PHASE", `reservation ${record.id} is already ${record.phase}`);
    }
    if (at >= record.expiresAt) {
      fail("LEASE_EXPIRED", `reservation ${record.id} expired at ${record.expiresAt}`);
    }
    if (action === "commit") {
      tenant.applyCommit(record.regionId, record.amount);
      record.phase = "committed";
      journal.append("reservation.committed", at, {
        reservationId: record.id,
        owner: record.owner,
        fence: record.fence,
      });
    } else {
      tenant.applyRelease(record.regionId, record.amount);
      record.phase = "released";
      journal.append("reservation.released", at, {
        reservationId: record.id,
        owner: record.owner,
        fence: record.fence,
      });
    }
    return { ...record };
  }

  expire(
    record: ReservationRecord,
    tenant: TenantState,
    at: number,
    journal: Journal,
  ): void {
    if (record.phase !== "active") {
      fail("RESERVATION_PHASE", `reservation ${record.id} is already ${record.phase}`);
    }
    if (record.expiresAt > at) {
      fail("LEASE_NOT_EXPIRED", `reservation ${record.id} expires at ${record.expiresAt}`);
    }
    tenant.applyRelease(record.regionId, record.amount);
    record.phase = "expired";
    journal.append("reservation.expired", at, { reservationId: record.id });
  }

  collectExpired(now: number): ReservationRecord[] {
    const expired: ReservationRecord[] = [];
    for (const record of this.records.values()) {
      if (record.phase === "active" && record.expiresAt <= now) {
        expired.push(record);
      }
    }
    expired.sort((left, right) => {
      if (left.expiresAt !== right.expiresAt) {
        return left.expiresAt - right.expiresAt;
      }
      return Number(left.id.slice(1)) - Number(right.id.slice(1));
    });
    return expired;
  }
}
