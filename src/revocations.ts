import { RevocationSnapshot } from "./types";
import { deepCopy } from "./util";

interface RevocationState {
  unpublished: string[];
  published: string[];
}

export class RevocationStore {
  private readonly tenants = new Map<string, RevocationState>();

  private stateFor(tenant: string, create: boolean): RevocationState | undefined {
    let state = this.tenants.get(tenant);
    if (!state && create) {
      state = { unpublished: [], published: [] };
      this.tenants.set(tenant, state);
    }
    return state;
  }

  add(tenant: string, serial: string): void {
    this.stateFor(tenant, true)!.unpublished.push(serial);
  }

  unpublished(tenant: string): string[] {
    return [...(this.stateFor(tenant, false)?.unpublished ?? [])];
  }

  publish(tenant: string): string[] {
    const state = this.stateFor(tenant, false);
    if (!state || state.unpublished.length === 0) {
      return [];
    }
    const moved = [...state.unpublished];
    state.published.push(...state.unpublished);
    state.unpublished = [];
    return moved;
  }

  snapshot(): [string, RevocationSnapshot][] {
    return [...this.tenants.entries()].map(
      ([tenant, state]) => [tenant, deepCopy(state)] as [string, RevocationSnapshot],
    );
  }

  restore(snapshot: [string, RevocationSnapshot][]): void {
    this.tenants.clear();
    for (const [tenant, state] of snapshot) {
      this.tenants.set(tenant, deepCopy(state));
    }
  }
}
