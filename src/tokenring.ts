import { VirtualClock } from "./clock.js";
import type { NodeState } from "./types.js";
import { TNode } from "./node.js";
import { nextOnline } from "./ring.js";
import { InvalidNodeError, InvalidStateError, OfflineError } from "./errors.js";

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
    this.nodes = Array.from({ length: nodeCount }, (_unused, id) => {
      const node = new TNode(id);
      if (id === 0) {
        node.hasToken = true;
      }
      return node;
    });
  }

  private node(id: number): TNode {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodes.length) {
      throw new InvalidNodeError(id);
    }
    return this.nodes[id];
  }

  private findTokenHolder(): TNode | null {
    return this.nodes.find((n) => n.online && n.hasToken) ?? null;
  }

  private deliverToken(id: number): void {
    const node = this.nodes[id];
    node.hasToken = true;
    this.lastTokenAt = this.clock.now();
    if (node.wantEnter) {
      node.inCs = true;
    }
  }

  request(id: number): void {
    const node = this.node(id);
    if (!node.online) {
      throw new OfflineError(id);
    }
    node.wantEnter = true;
    if (node.hasToken && !node.inCs) {
      node.inCs = true;
    }
  }

  exit(id: number): void {
    const node = this.node(id);
    if (!node.inCs) {
      throw new InvalidStateError(`node ${id} is not in critical section`);
    }
    node.inCs = false;
    node.wantEnter = false;
    node.hasToken = false;
    this.deliverToken(nextOnline(this.nodes, id));
  }

  pass(): void {
    const holder = this.findTokenHolder();
    if (!holder) {
      return;
    }
    if (holder.inCs) {
      throw new InvalidStateError(
        `node ${holder.id} is in critical section and cannot pass the token`,
      );
    }
    holder.hasToken = false;
    this.deliverToken(nextOnline(this.nodes, holder.id));
  }

  tick(): void {
    this.clock.advance(1);
    const now = this.clock.now();
    if (now - this.lastTokenAt < this.tokenTimeout) {
      return;
    }
    const tokenHeld = this.nodes.some(
      (n) => n.online && (n.hasToken || n.inCs),
    );
    if (tokenHeld) {
      return;
    }
    const minOnline = this.nodes.find((n) => n.online);
    if (!minOnline) {
      return;
    }
    this.deliverToken(minOnline.id);
  }

  setOnline(id: number, online: boolean): void {
    const node = this.node(id);
    if (node.online === online) {
      return;
    }
    node.online = online;
    if (!online && (node.inCs || node.hasToken)) {
      node.inCs = false;
      node.hasToken = false;
      node.wantEnter = false;
    }
  }

  state(id: number): NodeState {
    const node = this.node(id);
    if (node.inCs) {
      return "holding";
    }
    if (node.wantEnter) {
      return "waiting";
    }
    return "idle";
  }

  hasToken(id: number): boolean {
    const node = this.node(id);
    return node.online && node.hasToken;
  }

  tokenHolder(): number | null {
    return this.findTokenHolder()?.id ?? null;
  }

  inCs(): number | null {
    return this.nodes.find((n) => n.online && n.inCs)?.id ?? null;
  }

  isOnline(id: number): boolean {
    return this.node(id).online;
  }
}
