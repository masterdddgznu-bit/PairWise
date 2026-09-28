import { VirtualClock } from "./clock.js";
import { ConfigError } from "./errors.js";
import { Node } from "./node.js";
import { preferenceList } from "./ring.js";
import {
  compareDots,
  type Dot,
  type GetResult,
  type Hint,
  type PutResult,
} from "./types.js";

/** Dynamo-style sloppy quorum cluster with hinted handoff and read repair. */
export class HintCluster {
  private readonly nodes = new Map<string, Node>();
  private readonly counters = new Map<string, number>();

  constructor(
    private readonly clock: VirtualClock,
    private readonly nodeIds: string[],
    private readonly n: number,
    private readonly r: number,
    private readonly w: number,
  ) {
    const valid =
      Number.isInteger(n) &&
      Number.isInteger(r) &&
      Number.isInteger(w) &&
      n >= 1 &&
      r >= 1 &&
      w >= 1 &&
      r <= n &&
      w <= n &&
      n <= nodeIds.length;
    if (!valid) {
      throw new ConfigError(
        `Invalid cluster configuration: n=${n}, r=${r}, w=${w}, nodes=${nodeIds.length}`,
      );
    }
    for (const id of nodeIds) {
      this.nodes.set(id, new Node());
    }
  }

  preferenceList(key: string): string[] {
    return preferenceList(key, this.nodeIds, this.n);
  }

  put(key: string, value: string, available: string[]): PutResult {
    const pref = this.preferenceList(key);
    const avail = new Set(available);
    const holder = pref.find((id) => avail.has(id)) ?? this.known(available);
    const written: string[] = [];
    const hinted: { holder: string; target: string }[] = [];
    if (holder !== undefined) {
      const version = this.nextVersion(holder);
      for (const id of pref) {
        if (avail.has(id)) {
          this.nodes.get(id)!.putPrimary(key, value, version);
          written.push(id);
        } else {
          this.nodes.get(holder)!.storeHint({ target: id, key, value, version });
          hinted.push({ holder, target: id });
        }
      }
    }
    return { ok: written.length >= this.w, written, hinted };
  }

  get(key: string, available: string[]): GetResult {
    const pref = this.preferenceList(key);
    const avail = new Set(available);
    const readers = pref.filter((id) => avail.has(id)).slice(0, this.r);
    let winner: { value: string; version: Dot } | undefined;
    for (const id of readers) {
      const entry = this.nodes.get(id)!.getPrimaryEntry(key);
      if (entry && (!winner || compareDots(entry.version, winner.version) > 0)) {
        winner = entry;
      }
    }
    let repaired = 0;
    if (winner) {
      for (const id of readers) {
        const entry = this.nodes.get(id)!.getPrimaryEntry(key);
        if (!entry || compareDots(entry.version, winner.version) < 0) {
          this.nodes.get(id)!.putPrimary(key, winner.value, winner.version);
          repaired++;
        }
      }
    }
    return { value: winner?.value, repaired };
  }

  deliverHints(holder: string, target: string): number {
    const holderNode = this.nodes.get(holder);
    const targetNode = this.nodes.get(target);
    if (!holderNode || !targetNode) return 0;
    const hints = holderNode.takeHintsForTarget(target);
    for (const hint of hints) {
      targetNode.putPrimary(hint.key, hint.value, hint.version);
    }
    return hints.length;
  }

  hintsFor(holder: string): Hint[] {
    return this.nodes.get(holder)?.hintsFor() ?? [];
  }

  nodeGet(nodeId: string, key: string): string | undefined {
    return this.nodes.get(nodeId)?.getPrimary(key);
  }

  private known(ids: string[]): string | undefined {
    return ids.find((id) => this.nodes.has(id));
  }

  private nextVersion(coordinator: string): Dot {
    const counter = (this.counters.get(coordinator) ?? 0) + 1;
    this.counters.set(coordinator, counter);
    return { nodeId: coordinator, counter };
  }
}
