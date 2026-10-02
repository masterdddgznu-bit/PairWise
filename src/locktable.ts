import type { Grant, LockMode } from "./types.js";
import { compatible } from "./compat.js";

export class LockTable {
  private readonly byKey = new Map<string, Grant[]>();

  holders(key: string): Grant[] {
    return [...(this.byKey.get(key) ?? [])];
  }

  modeOf(txId: string, key: string): LockMode | null {
    const g = (this.byKey.get(key) ?? []).find((x) => x.txId === txId);
    return g?.mode ?? null;
  }

  keysOf(txId: string): string[] {
    const out: string[] = [];
    for (const [key, grants] of this.byKey) {
      if (grants.some((g) => g.txId === txId)) out.push(key);
    }
    return out;
  }

  set(txId: string, key: string, mode: LockMode): void {
    const list = this.byKey.get(key) ?? [];
    const idx = list.findIndex((g) => g.txId === txId);
    if (idx >= 0) list[idx] = { txId, mode };
    else list.push({ txId, mode });
    this.byKey.set(key, list);
  }

  removeAll(txId: string): string[] {
    const touched: string[] = [];
    for (const key of [...this.byKey.keys()]) {
      const list = this.byKey.get(key) ?? [];
      const next = list.filter((g) => g.txId !== txId);
      if (next.length !== list.length) touched.push(key);
      if (next.length === 0) this.byKey.delete(key);
      else this.byKey.set(key, next);
    }
    return touched;
  }

  blockers(txId: string, key: string, mode: LockMode): string[] {
    const out: string[] = [];
    for (const g of this.holders(key)) {
      if (g.txId === txId) continue;
      if (!compatible(g.mode, mode)) out.push(g.txId);
    }
    return out;
  }

  canGrant(txId: string, key: string, mode: LockMode): boolean {
    for (const g of this.holders(key)) {
      if (g.txId === txId) continue;
      if (!compatible(g.mode, mode)) return false;
    }
    return true;
  }
}
