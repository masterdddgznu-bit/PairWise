import { ObligationSnapshot, ObligationsSnapshot, ObligationState } from "./types";
import { deepCopy } from "./util";

export interface ObligationRecord {
  id: string;
  sourceSerial: string;
  state: ObligationState;
  claimant: string | null;
  fence: number;
  leaseExpiresAt: number | null;
}

export class ObligationStore {
  private readonly tenants = new Map<string, ObligationRecord[]>();
  private nextId = 1;
  private fence = 0;

  private listFor(tenant: string, create: boolean): ObligationRecord[] {
    let list = this.tenants.get(tenant);
    if (!list) {
      if (!create) {
        return [];
      }
      list = [];
      this.tenants.set(tenant, list);
    }
    return list;
  }

  createMany(tenant: string, sourceSerials: string[]): string[] {
    const list = this.listFor(tenant, true);
    const ids: string[] = [];
    for (const sourceSerial of sourceSerials) {
      const id = `ob-${this.nextId}`;
      this.nextId += 1;
      list.push({
        id,
        sourceSerial,
        state: "pending",
        claimant: null,
        fence: 0,
        leaseExpiresAt: null,
      });
      ids.push(id);
    }
    return ids;
  }

  nextPending(tenant: string): ObligationRecord | undefined {
    return this.listFor(tenant, false).find((ob) => ob.state === "pending");
  }

  get(tenant: string, id: string): ObligationRecord | undefined {
    return this.listFor(tenant, false).find((ob) => ob.id === id);
  }

  lease(record: ObligationRecord, agent: string, ttl: number, now: number): void {
    this.fence += 1;
    record.state = "leased";
    record.claimant = agent;
    record.fence = this.fence;
    record.leaseExpiresAt = now + ttl;
  }

  markCompleted(record: ObligationRecord): void {
    record.state = "completed";
    record.claimant = null;
    record.leaseExpiresAt = null;
  }

  cancelForSource(tenant: string, sourceSerial: string): string[] {
    const cancelled: string[] = [];
    for (const ob of this.listFor(tenant, false)) {
      if (
        ob.sourceSerial === sourceSerial &&
        (ob.state === "pending" || ob.state === "leased")
      ) {
        ob.state = "cancelled";
        ob.claimant = null;
        ob.leaseExpiresAt = null;
        cancelled.push(ob.id);
      }
    }
    return cancelled;
  }

  expiredLeases(now: number): ObligationRecord[] {
    const expired: ObligationRecord[] = [];
    for (const list of this.tenants.values()) {
      for (const ob of list) {
        if (ob.state === "leased" && ob.leaseExpiresAt !== null && ob.leaseExpiresAt <= now) {
          expired.push(ob);
        }
      }
    }
    return expired;
  }

  requeue(records: ObligationRecord[]): void {
    for (const record of records) {
      record.state = "pending";
      record.claimant = null;
      record.leaseExpiresAt = null;
    }
  }

  openCount(tenant?: string): number {
    const lists = tenant === undefined ? [...this.tenants.values()] : [this.listFor(tenant, false)];
    let total = 0;
    for (const list of lists) {
      for (const ob of list) {
        if (ob.state === "pending" || ob.state === "leased") {
          total += 1;
        }
      }
    }
    return total;
  }

  list(tenant: string): ObligationRecord[] {
    return [...this.listFor(tenant, false)];
  }

  snapshot(): ObligationsSnapshot {
    return {
      tenants: [...this.tenants.entries()].map(
        ([tenant, list]) =>
          [tenant, list.map((ob) => deepCopy(ob) as ObligationSnapshot)] as [
            string,
            ObligationSnapshot[],
          ],
      ),
      nextId: this.nextId,
      fence: this.fence,
    };
  }

  restore(snapshot: ObligationsSnapshot): void {
    this.tenants.clear();
    for (const [tenant, list] of snapshot.tenants) {
      this.tenants.set(tenant, list.map((ob) => deepCopy(ob)));
    }
    this.nextId = snapshot.nextId;
    this.fence = snapshot.fence;
  }
}
