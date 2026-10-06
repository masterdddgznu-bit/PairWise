import { TrustRollError } from "./errors";
import { AnchorSnapshot, RotationSnapshot } from "./types";
import { deepClone, sortedStrings } from "./util";

export interface AnchorState {
  issuance: number;
  trusted: number[];
  cohorts: string[];
  revision: number;
  rotation: RotationSnapshot | null;
}

export class AnchorRegistry {
  private readonly anchors = new Map<string, AnchorState>();

  has(tenant: string): boolean {
    return this.anchors.has(tenant);
  }

  get(tenant: string): AnchorState | undefined {
    return this.anchors.get(tenant);
  }

  require(tenant: string): AnchorState {
    const anchor = this.anchors.get(tenant);
    if (!anchor) {
      throw new TrustRollError("TENANT_UNKNOWN", `unknown tenant: ${tenant}`);
    }
    return anchor;
  }

  tenants(): string[] {
    return [...this.anchors.keys()];
  }

  register(tenant: string, generation: number, cohorts: string[]): void {
    this.anchors.set(tenant, {
      issuance: generation,
      trusted: [generation],
      cohorts: sortedStrings(cohorts),
      revision: 0,
      rotation: null,
    });
  }

  snapshot(): [string, AnchorSnapshot][] {
    return [...this.anchors.entries()].map(([tenant, anchor]) => [
      tenant,
      deepClone(anchor) as AnchorSnapshot,
    ]);
  }

  restore(entries: [string, AnchorSnapshot][]): void {
    this.anchors.clear();
    for (const [tenant, anchor] of entries) {
      this.anchors.set(tenant, deepClone(anchor));
    }
  }
}
