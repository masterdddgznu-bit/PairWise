import { VirtualClock } from "./clock.js";
import { TNode } from "./node.js";
import { nextOnline } from "./ring.js";
import {
  InvalidNodeError,
  InvalidStateError,
  OfflineError,
} from "./errors.js";
import type { NodeState } from "./types.js";

export type TokenRingOptions = {
  clock: VirtualClock;
  nodeCount?: number;
  tokenTimeout?: number;
};

export class TokenRing {
  readonly clock: VirtualClock;
  private readonly nodes: TNode[];
  private readonly tokenTimeout: number;
  private lastTokenAt = 0;

  constructor(opts: TokenRingOptions) {
    this.clock = opts.clock;
    const nodeCount = opts.nodeCount ?? 4;
    this.tokenTimeout = opts.tokenTimeout ?? 10;
    this.nodes = Array.from({ length: nodeCount }, (_, id) => new TNode(id));
    if (nodeCount > 0) {
      this.nodes[0].hasToken = true;
    }
  }

  private node(id: number): TNode {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodes.length) {
      throw new InvalidNodeError(id);
    }
    return this.nodes[id];
  }

  private deliver(id: number): void {
    const node = this.nodes[id];
    node.hasToken = true;
    this.lastTokenAt = this.clock.now();
    if (node.wantEnter) {
      node.inCs = true;
    }
  }

  private handOff(from: TNode): void {
    from.hasToken = false;
    const next = nextOnline(this.nodes, from.id);
    this.deliver(next);
  }

  request(id: number): void {
    const node = this.node(id);
    if (!node.online) throw new OfflineError(id);
    node.wantEnter = true;
    if (node.hasToken && !node.inCs) {
      node.inCs = true;
    }
  }

  exit(id: number): void {
    const node = this.node(id);
    if (!node.inCs) {
      throw new InvalidStateError(`node ${id} is not in the critical section`);
    }
    node.inCs = false;
    node.wantEnter = false;
    this.handOff(node);
  }

  pass(): void {
    const inCsNode = this.nodes.find((n) => n.inCs);
    if (inCsNode) {
      throw new InvalidStateError(
        `cannot pass token while node ${inCsNode.id} is in the critical section`,
      );
    }
    const holder = this.nodes.find((n) => n.online && n.hasToken);
    if (!holder) return;
    this.handOff(holder);
  }

  tick(): void {
    this.clock.advance(1);
    const now = this.clock.now();
    if (now - this.lastTokenAt < this.tokenTimeout) return;
    const alive = this.nodes.some((n) => n.online && (n.hasToken || n.inCs));
    if (alive) return;
    let minOnline = -1;
    for (const n of this.nodes) {
      if (n.online) {
        minOnline = n.id;
        break;
      }
    }
    if (minOnline === -1) return;
    this.deliver(minOnline);
  }

  setOnline(id: number, online: boolean): void {
    const node = this.node(id);
    if (!online) {
      node.hasToken = false;
      node.inCs = false;
      node.wantEnter = false;
    }
    node.online = online;
  }

  state(id: number): NodeState {
    const node = this.node(id);
    if (node.inCs) return "holding";
    if (node.wantEnter) return "waiting";
    return "idle";
  }

  hasToken(id: number): boolean {
    const node = this.node(id);
    return node.online && node.hasToken;
  }

  tokenHolder(): number | null {
    const holder = this.nodes.find((n) => n.online && n.hasToken);
    return holder ? holder.id : null;
  }

  inCs(): number | null {
    const cs = this.nodes.find((n) => n.inCs);
    return cs ? cs.id : null;
  }

  isOnline(id: number): boolean {
    return this.node(id).online;
  }
}
