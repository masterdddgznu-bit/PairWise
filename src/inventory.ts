import {
  CreateStripeInput,
  FragmentSpec,
  FragmentView,
  Limits,
  ManifestState,
  ManifestView,
  FragmentState,
} from "./types";

export interface ManifestRecord {
  stripeId: string;
  tenant: string;
  objectId: string;
  k: number;
  m: number;
  generation: number;
  predecessor: number | null;
  state: ManifestState;
  fragments: FragmentSpec[];
}

export interface FragmentRecord {
  id: string;
  stripeId: string;
  domain: string;
  state: FragmentState;
  generation: number;
}

export interface PublishRequest {
  stripeId: string;
  generation: number;
  targetFragment: string;
  targetDomain: string;
}

export class Inventory {
  private readonly manifests: ManifestRecord[] = [];
  private readonly fragments: FragmentRecord[] = [];

  constructor(private readonly limits: Limits) {}

  createStripe(input: CreateStripeInput): ManifestView {
    if (!input || typeof input !== "object") {
      throw new Error("invalid stripe: expected an object");
    }
    const { stripeId, tenant, objectId, k, m } = input;
    const fragments = input.fragments;
    if (!stripeId || !tenant || !objectId) {
      throw new Error("invalid stripe: stripeId, tenant and objectId are required");
    }
    if (
      !Number.isInteger(k) ||
      k < 1 ||
      !Number.isInteger(m) ||
      m < 0 ||
      !Array.isArray(fragments) ||
      fragments.length !== k + m
    ) {
      throw new Error("invalid stripe geometry: fragments must equal k + m with k >= 1");
    }
    if (this.manifests.some((existing) => existing.stripeId === stripeId)) {
      throw new Error(`duplicate stripe: ${stripeId}`);
    }
    const seenDomains = new Set<string>();
    const seenIds = new Set<string>();
    for (const fragment of fragments) {
      if (!fragment || typeof fragment.id !== "string" || fragment.id.length === 0) {
        throw new Error("invalid stripe: fragment id is required");
      }
      if (seenIds.has(fragment.id)) {
        throw new Error(`duplicate fragment: ${fragment.id}`);
      }
      seenIds.add(fragment.id);
      if (!this.limits.domains.includes(fragment.domain)) {
        throw new Error(`failure-domain "${fragment.domain}" is not available`);
      }
      if (seenDomains.has(fragment.domain)) {
        throw new Error(`failure-domain collision: ${fragment.domain}`);
      }
      seenDomains.add(fragment.domain);
      if (this.fragments.some((existing) => existing.id === fragment.id)) {
        throw new Error(`duplicate fragment: ${fragment.id}`);
      }
    }
    if (this.fragments.length + fragments.length > this.limits.fragmentSlots) {
      throw new Error(`fragment capacity: ${this.limits.fragmentSlots} slots exceeded`);
    }
    const manifest: ManifestRecord = {
      stripeId,
      tenant,
      objectId,
      k,
      m,
      generation: 1,
      predecessor: null,
      state: "active",
      fragments: fragments.map((fragment) => ({ id: fragment.id, domain: fragment.domain })),
    };
    this.manifests.push(manifest);
    for (const fragment of fragments) {
      this.fragments.push({
        id: fragment.id,
        stripeId,
        domain: fragment.domain,
        state: "healthy",
        generation: 1,
      });
    }
    return this.manifestView(manifest);
  }

  reportLoss(stripeId: string, fragmentId: string, kind: "missing" | "corrupt"): boolean {
    const fragment = this.fragmentById(fragmentId);
    if (!fragment || fragment.stripeId !== stripeId) {
      throw new Error(`unknown fragment: ${fragmentId}`);
    }
    if (fragment.state !== "healthy") {
      return false;
    }
    fragment.state = kind;
    return true;
  }

  publishSuccessor(plan: PublishRequest, producedId: string): ManifestView {
    const predecessor = this.activeManifest(plan.stripeId);
    if (!predecessor || predecessor.generation !== plan.generation) {
      throw new Error(
        `stale lineage: plan generation ${plan.generation} is not the active generation of stripe ${plan.stripeId}`,
      );
    }
    if (!producedId) {
      throw new Error("invalid produced fragment id");
    }
    if (this.fragments.some((fragment) => fragment.id === producedId)) {
      throw new Error(`duplicate fragment: ${producedId}`);
    }
    if (this.fragments.length + 1 > this.limits.fragmentSlots) {
      throw new Error(`fragment capacity: ${this.limits.fragmentSlots} slots exceeded`);
    }
    const generation = predecessor.generation + 1;
    const successor: ManifestRecord = {
      stripeId: predecessor.stripeId,
      tenant: predecessor.tenant,
      objectId: predecessor.objectId,
      k: predecessor.k,
      m: predecessor.m,
      generation,
      predecessor: predecessor.generation,
      state: "active",
      fragments: predecessor.fragments.map((fragment) =>
        fragment.id === plan.targetFragment
          ? { id: producedId, domain: plan.targetDomain }
          : { ...fragment },
      ),
    };
    const domains = new Set(successor.fragments.map((fragment) => fragment.domain));
    if (domains.size !== successor.fragments.length) {
      throw new Error("failure-domain collision in successor manifest");
    }
    predecessor.state = "obsolete";
    const replaced = this.fragmentById(plan.targetFragment);
    if (replaced) {
      replaced.state = "obsolete";
    }
    this.manifests.push(successor);
    this.fragments.push({
      id: producedId,
      stripeId: plan.stripeId,
      domain: plan.targetDomain,
      state: "healthy",
      generation,
    });
    return this.manifestView(successor);
  }

  reclaimObsolete(isPinned: (fragment: FragmentView) => boolean): string[] {
    const reclaimed: string[] = [];
    for (let index = this.fragments.length - 1; index >= 0; index -= 1) {
      const fragment = this.fragments[index];
      if (fragment.state === "obsolete" && !isPinned(this.fragmentView(fragment))) {
        this.fragments.splice(index, 1);
        reclaimed.unshift(fragment.id);
      }
    }
    return reclaimed;
  }

  activeManifest(stripeId: string): ManifestRecord | undefined {
    return this.manifests.find((manifest) => manifest.stripeId === stripeId && manifest.state === "active");
  }

  fragmentById(fragmentId: string): FragmentRecord | undefined {
    return this.fragments.find((fragment) => fragment.id === fragmentId);
  }

  healthyFragments(stripeId: string): FragmentRecord[] {
    return this.fragmentsOfActiveManifest(stripeId, (fragment) => fragment.state === "healthy");
  }

  lostFragments(stripeId: string): FragmentRecord[] {
    return this.fragmentsOfActiveManifest(
      stripeId,
      (fragment) => fragment.state === "missing" || fragment.state === "corrupt",
    );
  }

  generationsOf(fragmentId: string): number[] {
    const generations: number[] = [];
    for (const manifest of this.manifests) {
      if (manifest.fragments.some((fragment) => fragment.id === fragmentId)) {
        generations.push(manifest.generation);
      }
    }
    return generations;
  }

  manifestView(manifest: ManifestRecord): ManifestView {
    return {
      stripeId: manifest.stripeId,
      tenant: manifest.tenant,
      objectId: manifest.objectId,
      k: manifest.k,
      m: manifest.m,
      generation: manifest.generation,
      predecessor: manifest.predecessor,
      state: manifest.state,
      fragments: manifest.fragments.map((fragment) => ({ ...fragment })),
    };
  }

  fragmentView(fragment: FragmentRecord): FragmentView {
    return { ...fragment };
  }

  manifestViews(): ManifestView[] {
    return this.manifests.map((manifest) => this.manifestView(manifest));
  }

  fragmentViews(): FragmentView[] {
    return this.fragments.map((fragment) => this.fragmentView(fragment));
  }

  private fragmentsOfActiveManifest(
    stripeId: string,
    predicate: (fragment: FragmentRecord) => boolean,
  ): FragmentRecord[] {
    const manifest = this.activeManifest(stripeId);
    if (!manifest) {
      return [];
    }
    const matched: FragmentRecord[] = [];
    for (const spec of manifest.fragments) {
      const fragment = this.fragmentById(spec.id);
      if (fragment && predicate(fragment)) {
        matched.push(fragment);
      }
    }
    return matched;
  }
}
