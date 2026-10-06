import {
  CreateStripeInput,
  FragmentRecord,
  FragmentSpec,
  Limits,
  LossKind,
  Manifest,
  RepairPlan,
} from "./types";
import { deepCopy } from "./util";

export class Inventory {
  private manifests: Manifest[] = [];
  private fragments: FragmentRecord[] = [];

  constructor(private readonly limits: Limits) {}

  get fragmentCount(): number {
    return this.fragments.length;
  }

  activeManifest(stripeId: string): Manifest | undefined {
    return this.manifests.find(
      (m) => m.stripeId === stripeId && m.state === "active",
    );
  }

  manifestFor(stripeId: string, generation: number): Manifest | undefined {
    return this.manifests.find(
      (m) => m.stripeId === stripeId && m.generation === generation,
    );
  }

  fragment(id: string): FragmentRecord | undefined {
    return this.fragments.find((f) => f.id === id);
  }

  private assertDomains(stripeId: string, specs: FragmentSpec[]): void {
    const seen = new Set<string>();
    for (const spec of specs) {
      if (!this.limits.domains.includes(spec.domain)) {
        throw new Error(
          `unknown failure-domain "${spec.domain}" for stripe "${stripeId}"`,
        );
      }
      if (seen.has(spec.domain)) {
        throw new Error(
          `failure-domain collision: "${spec.domain}" repeats within stripe "${stripeId}"`,
        );
      }
      seen.add(spec.domain);
    }
  }

  addStripe(input: CreateStripeInput): Manifest {
    if (this.manifests.some((m) => m.stripeId === input.stripeId)) {
      throw new Error(`duplicate stripe "${input.stripeId}"`);
    }
    if (
      !Number.isInteger(input.k) ||
      !Number.isInteger(input.m) ||
      input.k < 1 ||
      input.m < 0 ||
      input.fragments.length !== input.k + input.m
    ) {
      throw new Error(
        `stripe shape: k + m must equal fragment count for "${input.stripeId}"`,
      );
    }
    this.assertDomains(input.stripeId, input.fragments);
    const seenIds = new Set<string>();
    for (const spec of input.fragments) {
      if (seenIds.has(spec.id) || this.fragment(spec.id)) {
        throw new Error(`duplicate fragment "${spec.id}"`);
      }
      seenIds.add(spec.id);
    }
    if (
      this.fragments.length + input.fragments.length >
      this.limits.fragmentSlots
    ) {
      throw new Error(
        `fragment capacity exceeded: need ${this.fragments.length + input.fragments.length} of ${this.limits.fragmentSlots} slots`,
      );
    }
    const manifest: Manifest = {
      stripeId: input.stripeId,
      tenant: input.tenant,
      objectId: input.objectId,
      k: input.k,
      m: input.m,
      generation: 1,
      predecessor: 0,
      state: "active",
      fragments: input.fragments.map((f) => ({ id: f.id, domain: f.domain })),
    };
    input.fragments.forEach((spec, index) => {
      this.fragments.push({
        id: spec.id,
        domain: spec.domain,
        stripeId: input.stripeId,
        index,
        state: "healthy",
      });
    });
    this.manifests.push(manifest);
    return deepCopy(manifest);
  }

  reportLoss(stripeId: string, fragmentId: string, kind: LossKind): void {
    const manifest = this.activeManifest(stripeId);
    if (!manifest) {
      throw new Error(`unknown stripe "${stripeId}"`);
    }
    if (!manifest.fragments.some((f) => f.id === fragmentId)) {
      throw new Error(
        `unknown fragment "${fragmentId}" in stripe "${stripeId}"`,
      );
    }
    const record = this.fragment(fragmentId);
    if (!record || record.state !== "healthy") {
      throw new Error(`fragment "${fragmentId}" is not healthy`);
    }
    record.state = kind;
  }

  healthyFragments(manifest: Manifest): FragmentRecord[] {
    return manifest.fragments
      .map((f) => this.fragment(f.id))
      .filter((r): r is FragmentRecord => !!r && r.state === "healthy");
  }

  lostFragments(manifest: Manifest): FragmentRecord[] {
    return manifest.fragments
      .map((f) => this.fragment(f.id))
      .filter(
        (r): r is FragmentRecord =>
          !!r && (r.state === "missing" || r.state === "corrupt"),
      );
  }

  assertPublishable(producedId: string): void {
    if (this.fragment(producedId)) {
      throw new Error(`duplicate fragment "${producedId}"`);
    }
    if (this.fragments.length + 1 > this.limits.fragmentSlots) {
      throw new Error(
        `fragment capacity exceeded: need ${this.fragments.length + 1} of ${this.limits.fragmentSlots} slots`,
      );
    }
  }

  publishSuccessor(plan: RepairPlan, producedId: string): Manifest {
    const predecessor = this.activeManifest(plan.stripeId);
    if (!predecessor || predecessor.generation !== plan.generation) {
      throw new Error(
        `lineage mismatch: plan "${plan.id}" targets generation ${plan.generation} of "${plan.stripeId}"`,
      );
    }
    const replaced = this.fragment(plan.replaces);
    if (!replaced) {
      throw new Error(`lineage mismatch: replaced fragment "${plan.replaces}" is gone`);
    }
    const next: Manifest = {
      stripeId: predecessor.stripeId,
      tenant: predecessor.tenant,
      objectId: predecessor.objectId,
      k: predecessor.k,
      m: predecessor.m,
      generation: predecessor.generation + 1,
      predecessor: predecessor.generation,
      state: "active",
      fragments: predecessor.fragments.map((f) =>
        f.id === plan.replaces
          ? { id: producedId, domain: plan.targetDomain }
          : { id: f.id, domain: f.domain },
      ),
    };
    replaced.state = "obsolete";
    predecessor.state = "obsolete";
    this.fragments.push({
      id: producedId,
      domain: plan.targetDomain,
      stripeId: plan.stripeId,
      index: replaced.index,
      state: "healthy",
    });
    this.manifests.push(next);
    return deepCopy(next);
  }

  reclaim(isPinned: (fragmentId: string) => boolean): string[] {
    const reclaimed: string[] = [];
    this.fragments = this.fragments.filter((f) => {
      if (f.state === "obsolete" && !isPinned(f.id)) {
        reclaimed.push(f.id);
        return false;
      }
      return true;
    });
    return reclaimed;
  }

  snapshot(): { manifests: Manifest[]; fragments: FragmentRecord[] } {
    return {
      manifests: deepCopy(this.manifests),
      fragments: deepCopy(this.fragments),
    };
  }
}
