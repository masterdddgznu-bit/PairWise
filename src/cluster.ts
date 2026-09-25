export type VectorClock = Record<string, number>;

export interface Version {
  value: string;
  clock: VectorClock;
}

export interface PutResult {
  coordinator: string;
  clock: VectorClock;
}

export interface GetResult {
  values: string[];
  context: VectorClock;
}

export interface ClusterStats {
  up: number;
  hints: number;
}

interface Hint {
  key: string;
  version: Version;
}

/**
 * Dynamo 风格仲裁 KV。起始实现未完成。
 */
export class Cluster {
  private readonly nodeIds: string[];
  private readonly W: number;
  private readonly R: number;
  private readonly online = new Set<string>();
  private readonly stores = new Map<string, Map<string, Version[]>>();
  private readonly hintQueues = new Map<string, Hint[]>();

  constructor(nodeIds: string[], W: number, R: number) {
    this.nodeIds = [...nodeIds];
    this.W = W;
    this.R = R;
    for (const id of this.nodeIds) {
      this.online.add(id);
      this.stores.set(id, new Map());
      this.hintQueues.set(id, []);
    }
  }

  put(key: string, value: string, context: VectorClock = {}): PutResult {
    const live = this.liveNodes();
    if (live.length < this.W) {
      throw new Error(
        `not enough live nodes: have ${live.length}, need ${this.W}`,
      );
    }

    const coordinator = live[0];
    const localClocks = this.localVersions(coordinator, key).map(
      (version) => version.clock,
    );
    const clock = this.mergeClocks([context, ...localClocks]);
    clock[coordinator] = (clock[coordinator] ?? 0) + 1;
    const version: Version = { value, clock };

    for (const id of live.slice(0, this.W)) {
      const store = this.stores.get(id)!;
      store.set(key, this.mergeVersion(store.get(key) ?? [], version));
    }

    for (const id of this.nodeIds) {
      if (!this.online.has(id)) {
        this.hintQueues
          .get(id)!
          .push({ key, version: this.cloneVersion(version) });
      }
    }

    return { coordinator, clock: this.cloneClock(clock) };
  }

  get(key: string): GetResult {
    const live = this.liveNodes();
    if (live.length < this.R) {
      throw new Error(
        `not enough live nodes: have ${live.length}, need ${this.R}`,
      );
    }

    const contacted = live.slice(0, this.R);
    const gathered: Version[] = [];
    for (const id of contacted) {
      gathered.push(...this.localVersions(id, key));
    }

    const survivors = this.sortByValue(this.prune(gathered));
    const context = this.mergeClocks(survivors.map((version) => version.clock));

    for (const id of contacted) {
      const local = this.localVersions(id, key);
      if (!this.sameVersionSet(local, survivors)) {
        this.stores
          .get(id)!
          .set(key, survivors.map((version) => this.cloneVersion(version)));
      }
    }

    return { values: survivors.map((version) => version.value), context };
  }

  fail(id: string): void {
    this.requireNode(id);
    this.online.delete(id);
  }

  recover(id: string): void {
    this.requireNode(id);
    if (this.online.has(id)) {
      return;
    }
    this.online.add(id);

    const queue = this.hintQueues.get(id)!;
    const store = this.stores.get(id)!;
    for (const hint of queue) {
      store.set(
        hint.key,
        this.mergeVersion(store.get(hint.key) ?? [], hint.version),
      );
    }
    queue.length = 0;
  }

  dump(id: string, key: string): Version[] {
    this.requireNode(id);
    return this.sortByValue(this.prune(this.localVersions(id, key))).map(
      (version) => this.cloneVersion(version),
    );
  }

  stats(): ClusterStats {
    let hints = 0;
    for (const id of this.nodeIds) {
      if (!this.online.has(id)) {
        hints += this.hintQueues.get(id)!.length;
      }
    }
    return { up: this.online.size, hints };
  }

  private requireNode(id: string): void {
    if (!this.stores.has(id)) {
      throw new Error(`unknown node: ${id}`);
    }
  }

  private liveNodes(): string[] {
    return this.nodeIds.filter((id) => this.online.has(id));
  }

  private localVersions(id: string, key: string): Version[] {
    return this.stores.get(id)?.get(key) ?? [];
  }

  private clockValue(clock: VectorClock, node: string): number {
    return clock[node] ?? 0;
  }

  private mergeClocks(clocks: VectorClock[]): VectorClock {
    const merged: VectorClock = {};
    for (const clock of clocks) {
      for (const [node, raw] of Object.entries(clock)) {
        const value = Number(raw);
        if (Number.isFinite(value) && value > 0) {
          merged[node] = Math.max(merged[node] ?? 0, value);
        }
      }
    }
    return merged;
  }

  private dominates(a: VectorClock, b: VectorClock): boolean {
    let strict = false;
    for (const node of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const left = this.clockValue(a, node);
      const right = this.clockValue(b, node);
      if (left < right) {
        return false;
      }
      if (left > right) {
        strict = true;
      }
    }
    return strict;
  }

  private clocksEqual(a: VectorClock, b: VectorClock): boolean {
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) {
      return false;
    }
    return keysA.every((node) => this.clockValue(a, node) === this.clockValue(b, node));
  }

  private sameVersion(a: Version, b: Version): boolean {
    return a.value === b.value && this.clocksEqual(a.clock, b.clock);
  }

  private sameVersionSet(a: Version[], b: Version[]): boolean {
    return (
      a.length === b.length &&
      a.every((version) => b.some((other) => this.sameVersion(version, other)))
    );
  }

  private prune(versions: Version[]): Version[] {
    const unique: Version[] = [];
    for (const version of versions) {
      if (!unique.some((other) => this.sameVersion(other, version))) {
        unique.push(version);
      }
    }
    return unique.filter(
      (version) =>
        !unique.some(
          (other) =>
            other !== version && this.dominates(other.clock, version.clock),
        ),
    );
  }

  private mergeVersion(list: Version[], incoming: Version): Version[] {
    const merged: Version[] = [];
    let sawEqualClock = false;
    let incomingDominated = false;

    for (const version of list) {
      if (this.clocksEqual(version.clock, incoming.clock)) {
        sawEqualClock = true;
        merged.push(version);
        continue;
      }
      if (this.dominates(incoming.clock, version.clock)) {
        continue;
      }
      if (this.dominates(version.clock, incoming.clock)) {
        incomingDominated = true;
      }
      merged.push(version);
    }

    if (!sawEqualClock && !incomingDominated) {
      merged.push(incoming);
    }
    return merged;
  }

  private sortByValue(versions: Version[]): Version[] {
    return [...versions].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  }

  private cloneClock(clock: VectorClock): VectorClock {
    return { ...clock };
  }

  private cloneVersion(version: Version): Version {
    return { value: version.value, clock: this.cloneClock(version.clock) };
  }
}
