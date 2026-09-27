import type { LockMode } from "./types.js";

type Grant = { txn: string; mode: LockMode };

/** Holds locks granted to txns. Base: single X holder per resource. */
export class LockStore {
  private readonly byRes = new Map<string, Grant[]>();

  holders(resource: string): Grant[] {
    return [...(this.byRes.get(resource) ?? [])];
  }

  modeOf(txn: string, resource: string): LockMode | null {
    const g = (this.byRes.get(resource) ?? []).find((x) => x.txn === txn);
    return g?.mode ?? null;
  }

  allByTxn(txn: string): { resource: string; mode: LockMode }[] {
    const out: { resource: string; mode: LockMode }[] = [];
    for (const [resource, grants] of this.byRes) {
      for (const g of grants) {
        if (g.txn === txn) out.push({ resource, mode: g.mode });
      }
    }
    return out;
  }

  set(txn: string, resource: string, mode: LockMode): void {
    const list = this.byRes.get(resource) ?? [];
    const idx = list.findIndex((g) => g.txn === txn);
    if (idx >= 0) list[idx] = { txn, mode };
    else list.push({ txn, mode });
    this.byRes.set(resource, list);
  }

  remove(txn: string, resource: string): boolean {
    const list = this.byRes.get(resource);
    if (!list) return false;
    const next = list.filter((g) => g.txn !== txn);
    if (next.length === list.length) return false;
    if (next.length === 0) this.byRes.delete(resource);
    else this.byRes.set(resource, next);
    return true;
  }

  removeAll(txn: string): string[] {
    const touched: string[] = [];
    for (const resource of [...this.byRes.keys()]) {
      if (this.remove(txn, resource)) touched.push(resource);
    }
    return touched;
  }
}
