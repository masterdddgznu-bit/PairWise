import { TrustRollError } from "./errors";
import { AnchorSnapshot } from "./types";
import { deepCopy } from "./util";

export interface RotationState {
  target: number;
  revision: number;
  requiredCohorts: string[];
  acknowledged: string[];
}

export interface AnchorState {
  trusted: number[];
  issuance: number;
  cohorts: string[];
  nextRevision: number;
  rotation: RotationState | null;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export class AnchorStore {
  private readonly tenants = new Map<string, AnchorState>();

  has(tenant: string): boolean {
    return this.tenants.has(tenant);
  }

  require(tenant: string): AnchorState {
    const state = this.tenants.get(tenant);
    if (!state) {
      throw new TrustRollError("UNKNOWN_TENANT", `unknown tenant: ${tenant}`);
    }
    return state;
  }

  register(tenant: string, generation: number, cohorts: string[]): void {
    this.tenants.set(tenant, {
      trusted: [generation],
      issuance: generation,
      cohorts: [...cohorts],
      nextRevision: 1,
      rotation: null,
    });
  }

  setCohorts(tenant: string, cohorts: string[]): void {
    this.require(tenant).cohorts = [...cohorts];
  }

  beginRotation(tenant: string, target: number): number {
    const state = this.require(tenant);
    const revision = state.nextRevision;
    state.nextRevision += 1;
    state.trusted.push(target);
    state.issuance = target;
    state.rotation = {
      target,
      revision,
      requiredCohorts: sortedUnique(state.cohorts),
      acknowledged: [],
    };
    return revision;
  }

  retireOld(tenant: string): number[] {
    const state = this.require(tenant);
    const removed = state.trusted.filter((g) => g < state.issuance);
    state.trusted = state.trusted.filter((g) => g >= state.issuance);
    state.rotation = null;
    return removed;
  }

  barrierSatisfied(tenant: string): boolean {
    const rotation = this.require(tenant).rotation;
    return (
      rotation !== null &&
      rotation.requiredCohorts.every((c) => rotation.acknowledged.includes(c))
    );
  }

  snapshot(): [string, AnchorSnapshot][] {
    return [...this.tenants.entries()].map(
      ([tenant, state]) => [tenant, deepCopy(state)] as [string, AnchorSnapshot],
    );
  }

  restore(snapshot: [string, AnchorSnapshot][]): void {
    this.tenants.clear();
    for (const [tenant, state] of snapshot) {
      this.tenants.set(tenant, deepCopy(state));
    }
  }

  static validate(snapshot: [string, AnchorSnapshot][]): void {
    for (const [tenant, state] of snapshot) {
      const trustedOk =
        Array.isArray(state.trusted) &&
        state.trusted.length > 0 &&
        state.trusted.every((g, i) => i === 0 || g > state.trusted[i - 1]) &&
        state.trusted.includes(state.issuance);
      if (!trustedOk) {
        throw new TrustRollError(
          "JOURNAL_PHASE",
          `impossible anchor phase for tenant ${tenant}`,
        );
      }
      const rotation = state.rotation;
      if (rotation !== null) {
        const rotationOk =
          rotation.target === state.issuance &&
          rotation.revision >= 1 &&
          rotation.revision < state.nextRevision &&
          rotation.requiredCohorts.every(
            (c, i) => i === 0 || c > rotation.requiredCohorts[i - 1],
          ) &&
          rotation.acknowledged.every((c) =>
            rotation.requiredCohorts.includes(c),
          );
        if (!rotationOk) {
          throw new TrustRollError(
            "JOURNAL_PHASE",
            `impossible rotation phase for tenant ${tenant}`,
          );
        }
      }
    }
  }
}
