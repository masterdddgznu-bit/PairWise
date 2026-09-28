import { VirtualClock } from "./clock.js";
import { ConfigError } from "./errors.js";
import { sortHints } from "./hintbox.js";
import { Node } from "./node.js";
import { preferenceList as ringPreferenceList } from "./ring.js";
import { compareDots, type Dot, type GetResult, type Hint, type PutResult } from "./types.js";

/**
 * Dynamo-style sloppy quorum cluster with hinted handoff and read repair.
 */
export class HintCluster {
  private readonly clock: VirtualClock;
  private readonly nodeIds: string[];
  private readonly n: number;
  private readonly r: number;
  private readonly w: number;
  private readonly nodes = new Map<string, Node>();
  private lastCounter = 0;

  constructor(
    clock: VirtualClock,
    nodeIds: string[],
    n: number,
    r: number,
    w: number,
  ) {
    if (
      !Number.isInteger(n) ||
      !Number.isInteger(r) ||
      !Number.isInteger(w) ||
      n < 1 ||
      r < 1 ||
      w < 1 ||
      r > n ||
      w > n ||
      n > nodeIds.length
    ) {
      throw new ConfigError();
    }
    this.clock = clock;
    this.nodeIds = [...nodeIds];
    this.n = n;
    this.r = r;
    this.w = w;
    for (const id of this.nodeIds) {
      this.nodes.set(id, new Node(id));
    }
  }

  put(key: string, value: string, available: string[]): PutResult {
    const pref = this.preferenceList(key);
    const avail = new Set(available);
    const version = this.nextDot(available[0] ?? "");
    const holder = available[0];
    const written: string[] = [];
    const hinted: { holder: string; target: string }[] = [];
    for (const id of pref) {
      if (avail.has(id)) {
        this.node(id).putPrimary(key, value, version);
        written.push(id);
      } else if (holder !== undefined) {
        this.node(holder).storeHint({ target: id, key, value, version });
        hinted.push({ holder, target: id });
      }
    }
    return { ok: written.length >= this.w, written, hinted };
  }

  get(key: string, available: string[]): GetResult {
    const pref = this.preferenceList(key);
    const avail = new Set(available);
    const readers = pref.filter((id) => avail.has(id)).slice(0, this.r);
    const entries = readers.map((id) => ({
      id,
      entry: this.node(id).getPrimaryEntry(key),
    }));
    let winner: { value: string; version: Dot } | undefined;
    for (const { entry } of entries) {
      if (entry && (!winner || compareDots(entry.version, winner.version) > 0)) {
        winner = entry;
      }
    }
    let repaired = 0;
    if (winner) {
      for (const { id, entry } of entries) {
        if (!entry || compareDots(entry.version, winner.version) < 0) {
          this.node(id).putPrimary(key, winner.value, winner.version);
          repaired += 1;
        }
      }
    }
    return { value: winner?.value, repaired };
  }

  deliverHints(holder: string, target: string): number {
    const hints = this.node(holder).takeHintsForTarget(target);
    const targetNode = this.node(target);
    for (const hint of hints) {
      targetNode.putPrimary(hint.key, hint.value, hint.version);
    }
    return hints.length;
  }

  preferenceList(key: string): string[] {
    return ringPreferenceList(key, this.nodeIds, this.n);
  }

  hintsFor(holder: string): Hint[] {
    return sortHints(this.node(holder).hintsFor());
  }

  nodeGet(nodeId: string, key: string): string | undefined {
    return this.node(nodeId).getPrimary(key);
  }

  private node(id: string): Node {
    let node = this.nodes.get(id);
    if (!node) {
      node = new Node(id);
      this.nodes.set(id, node);
    }
    return node;
  }

  private nextDot(coordinator: string): Dot {
    const counter = Math.max(this.clock.now(), this.lastCounter + 1);
    this.lastCounter = counter;
    return { nodeId: coordinator, counter };
  }
}
