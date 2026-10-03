export class LockTable {
  private held = new Map<string, Map<string, string>>();

  tryLock(participantId: string, txnId: string, keys: string[]): boolean {
    const owned = this.held.get(participantId) ?? new Map<string, string>();
    for (const key of keys) {
      const holder = owned.get(key);
      if (holder !== undefined && holder !== txnId) return false;
    }
    for (const key of keys) owned.set(key, txnId);
    if (owned.size > 0) this.held.set(participantId, owned);
    return true;
  }

  releaseTxn(participantId: string, txnId: string): void {
    const owned = this.held.get(participantId);
    if (!owned) return;
    for (const [key, holder] of [...owned]) {
      if (holder === txnId) owned.delete(key);
    }
    if (owned.size === 0) this.held.delete(participantId);
  }

  locksOf(participantId: string): string[] {
    const owned = this.held.get(participantId);
    if (!owned) return [];
    return [...owned.keys()].sort();
  }

  exportState(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const [pid, owned] of this.held) {
      out[pid] = Object.fromEntries(owned);
    }
    return out;
  }

  importState(state: Record<string, Record<string, string>>): void {
    this.held.clear();
    for (const [pid, owned] of Object.entries(state)) {
      const map = new Map(Object.entries(owned));
      if (map.size > 0) this.held.set(pid, map);
    }
  }
}
