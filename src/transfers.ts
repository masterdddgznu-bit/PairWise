import { fail } from "./errors";
import { Journal } from "./journal";
import { TenantState } from "./tenant";
import { TransferRecord } from "./types";

export interface PrepareRequest {
  from: string;
  to: string;
  amount: number;
  epoch: number;
  nonce: string;
  at: number;
}

export class TransferLedger {
  private readonly records = new Map<string, TransferRecord>();
  private readonly keys = new Map<string, string>();
  private readonly laneEpochs = new Map<string, number>();
  private counter = 0;

  get(id: string): TransferRecord | undefined {
    return this.records.get(id);
  }

  view(id: string): TransferRecord | null {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  prepare(
    tenant: TenantState,
    request: PrepareRequest,
    replay: boolean,
    expectedId: string | null,
    journal: Journal,
  ): TransferRecord {
    const lane = `${tenant.tenantId} ${request.from} ${request.to}`;
    const key = `${lane} ${request.epoch} ${request.nonce}`;
    const existingId = this.keys.get(key);
    if (existingId !== undefined) {
      const existing = this.records.get(existingId)!;
      if (existing.amount !== request.amount) {
        fail("TRANSFER_CONFLICT", "epoch/nonce identity already used with a different amount");
      }
      if (replay) {
        fail("DUPLICATE_MUTATION", `transfer ${existingId} was already prepared`);
      }
      return { ...existing };
    }
    const lastEpoch = this.laneEpochs.get(lane) ?? 0;
    if (request.epoch <= lastEpoch) {
      fail("STALE_EPOCH", `lane epoch ${request.epoch} is not newer than ${lastEpoch}`);
    }
    tenant.assertLocalCapacity(request.from, request.amount);
    const id = `t${++this.counter}`;
    if (expectedId !== null && expectedId !== id) {
      fail("JOURNAL_MISMATCH", `journal transfer id ${expectedId} does not match next id ${id}`);
    }
    tenant.applyLock(request.from, request.amount);
    const record: TransferRecord = {
      id,
      tenantId: tenant.tenantId,
      from: request.from,
      to: request.to,
      amount: request.amount,
      epoch: request.epoch,
      nonce: request.nonce,
      phase: "prepared",
      preparedAt: request.at,
      settledAt: null,
    };
    this.records.set(id, record);
    this.keys.set(key, id);
    this.laneEpochs.set(lane, request.epoch);
    journal.append("transfer.prepared", request.at, {
      transferId: id,
      tenantId: record.tenantId,
      from: record.from,
      to: record.to,
      amount: record.amount,
      epoch: record.epoch,
      nonce: record.nonce,
    });
    return { ...record };
  }

  accept(
    record: TransferRecord,
    tenant: TenantState,
    at: number,
    replay: boolean,
    journal: Journal,
  ): TransferRecord {
    if (record.phase === "accepted") {
      if (replay) {
        fail("DUPLICATE_MUTATION", `transfer ${record.id} was already accepted`);
      }
      return { ...record };
    }
    if (record.phase === "cancelled") {
      fail("TRANSFER_PHASE", `transfer ${record.id} is cancelled and cannot be accepted`);
    }
    tenant.applySettleLock(record.from, record.to, record.amount);
    record.phase = "accepted";
    record.settledAt = at;
    journal.append("transfer.accepted", at, {
      transferId: record.id,
      epoch: record.epoch,
      nonce: record.nonce,
    });
    return { ...record };
  }

  cancel(
    record: TransferRecord,
    tenant: TenantState,
    at: number,
    replay: boolean,
    journal: Journal,
  ): TransferRecord {
    if (record.phase === "cancelled") {
      if (replay) {
        fail("DUPLICATE_MUTATION", `transfer ${record.id} was already cancelled`);
      }
      return { ...record };
    }
    if (record.phase === "accepted") {
      fail("TRANSFER_PHASE", `transfer ${record.id} is accepted and cannot be cancelled`);
    }
    tenant.applyUnlock(record.from, record.amount);
    record.phase = "cancelled";
    record.settledAt = at;
    journal.append("transfer.cancelled", at, {
      transferId: record.id,
      epoch: record.epoch,
      nonce: record.nonce,
    });
    return { ...record };
  }
}
