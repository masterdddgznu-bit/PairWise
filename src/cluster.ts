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

/**
 * Dynamo 风格仲裁 KV。起始实现未完成。
 */
export class Cluster {
  private readonly nodeIds: string[];
  private readonly W: number;
  private readonly R: number;
  private readonly alive = new Set<string>();
  private readonly store = new Map<string, Map<string, Version[]>>();
  private readonly hints = new Map<string, Hint[]>();

  constructor(nodeIds: string[], W: number, R: number) {
    this.nodeIds = [...nodeIds];
    this.W = W;
    this.R = R;
    for (const id of this.nodeIds) {
      this.alive.add(id);
      this.store.set(id, new Map<string, Version[]>());
      this.hints.set(id, []);
    }
  }

  put(key: string, value: string, context: VectorClock = {}): PutResult {
    const up = this.onlineNodes();
    if (up.length < this.W) {
      throw new Error(
        `insufficient write quorum: ${up.length} live nodes, need ${this.W}`,
      );
    }

    const coordinator = up[0];
    const clock: VectorClock = { ...context };
    const local = this.store.get(coordinator)!;
    for (const version of local.get(key) ?? []) {
      mergeClockInto(clock, version.clock);
    }
    clock[coordinator] = (clock[coordinator] ?? 0) + 1;

    const written: Version = { value, clock };
    for (const id of up.slice(0, this.W)) {
      this.mergeVersion(id, key, written);
    }
    for (const id of this.nodeIds) {
      if (!this.alive.has(id)) {
        this.hints.get(id)!.push({ key, version: written });
      }
    }

    return { coordinator, clock };
  }

  get(key: string): GetResult {
    const up = this.onlineNodes();
    if (up.length < this.R) {
      throw new Error(
        `insufficient read quorum: ${up.length} live nodes, need ${this.R}`,
      );
    }

    const contacted = up.slice(0, this.R);
    const gathered: Version[] = [];
    for (const id of contacted) {
      gathered.push(...(this.store.get(id)!.get(key) ?? []));
    }

    const survivors = pruneDominants(dedupeVersions(gathered));
    const sorted = sortVersions(survivors);
    const context: VectorClock = {};
    for (const version of sorted) {
      mergeClockInto(context, version.clock);
    }

    for (const id of contacted) {
      const replica = this.store.get(id)!;
      const local = replica.get(key) ?? [];
      if (!sameVersionSet(local, sorted)) {
        replica.set(key, cloneVersions(sorted));
      }
    }

    return { values: sorted.map((version) => version.value), context };
  }

  fail(id: string): void {
    if (this.store.has(id)) {
      this.alive.delete(id);
    }
  }

  recover(id: string): void {
    if (!this.store.has(id) || this.alive.has(id)) {
      return;
    }
    this.alive.add(id);
    const queue = this.hints.get(id)!;
    for (const hint of queue) {
      this.mergeVersion(id, hint.key, hint.version);
    }
    queue.length = 0;
  }

  dump(id: string, key: string): Version[] {
    const replica = this.store.get(id);
    if (replica === undefined) {
      throw new Error(`unknown node: ${id}`);
    }
    return cloneVersions(sortVersions(pruneDominants(replica.get(key) ?? [])));
  }

  stats(): ClusterStats {
    let pending = 0;
    for (const id of this.nodeIds) {
      if (!this.alive.has(id)) {
        pending += this.hints.get(id)!.length;
      }
    }
    return { up: this.alive.size, hints: pending };
  }

  private onlineNodes(): string[] {
    return this.nodeIds.filter((id) => this.alive.has(id));
  }

  private mergeVersion(id: string, key: string, incoming: Version): void {
    const replica = this.store.get(id)!;
    const current = replica.get(key) ?? [];

    if (current.some((version) => clocksEqual(version.clock, incoming.clock))) {
      return;
    }

    const kept = current.filter((version) => !dominates(incoming.clock, version.clock));
    if (kept.some((version) => dominates(version.clock, incoming.clock))) {
      replica.set(key, kept);
      return;
    }

    kept.push({ value: incoming.value, clock: { ...incoming.clock } });
    replica.set(key, kept);
  }
}

interface Hint {
  key: string;
  version: Version;
}

function clockEntries(clock: VectorClock): Array<[string, number]> {
  return Object.entries(clock).filter(([, count]) => count !== 0);
}

function mergeClockInto(target: VectorClock, source: VectorClock): void {
  for (const [node, count] of clockEntries(source)) {
    if ((target[node] ?? 0) < count) {
      target[node] = count;
    }
  }
}

function dominates(a: VectorClock, b: VectorClock): boolean {
  let hasStrict = false;
  for (const [node, count] of clockEntries(a)) {
    const other = b[node] ?? 0;
    if (count < other) {
      return false;
    }
    if (count > other) {
      hasStrict = true;
    }
  }
  for (const [node, count] of clockEntries(b)) {
    if (!(node in a)) {
      if (count > 0) {
        return false;
      }
    }
  }
  return hasStrict;
}

function clocksEqual(a: VectorClock, b: VectorClock): boolean {
  for (const [node, count] of clockEntries(a)) {
    if ((b[node] ?? 0) !== count) {
      return false;
    }
  }
  for (const [node, count] of clockEntries(b)) {
    if ((a[node] ?? 0) !== count) {
      return false;
    }
  }
  return true;
}

function versionKey(version: Version): string {
  const clock = clockEntries(version.clock)
    .map(([node, count]) => `${node}=${count}`)
    .sort()
    .join(",");
  return `${versionValueKey(version.value)}|${clock}`;
}

function versionValueKey(value: string): string {
  return JSON.stringify(value);
}

function dedupeVersions(versions: Version[]): Version[] {
  const seen = new Set<string>();
  const result: Version[] = [];
  for (const version of versions) {
    const key = versionKey(version);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(version);
    }
  }
  return result;
}

function pruneDominants(versions: Version[]): Version[] {
  return versions.filter(
    (candidate) =>
      !versions.some(
        (other) =>
          other !== candidate && dominates(other.clock, candidate.clock),
      ),
  );
}

function sortVersions(versions: Version[]): Version[] {
  return [...versions].sort((a, b) => {
    if (a.value < b.value) {
      return -1;
    }
    if (a.value > b.value) {
      return 1;
    }
    const ka = versionKey(a);
    const kb = versionKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function sameVersionSet(a: Version[], b: Version[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const keys = new Set(a.map(versionKey));
  return b.every((version) => keys.has(versionKey(version)));
}

function cloneVersions(versions: Version[]): Version[] {
  return versions.map((version) => ({
    value: version.value,
    clock: { ...version.clock },
  }));
}
