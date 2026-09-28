import { VirtualClock } from "./clock.js";
import { BNode } from "./node.js";
import type { Msg } from "./messages.js";
import type { NodeState } from "./types.js";
import { InvalidNodeError, OfflineError } from "./errors.js";

export type BullyOptions = {
  clock: VirtualClock;
  nodeCount?: number;
  electionTimeout?: number;
};

export class Bully {
  readonly clock: VirtualClock;
  private readonly nodes: BNode[];
  private readonly electionTimeout: number;

  constructor(opts: BullyOptions) {
    this.clock = opts.clock;
    this.electionTimeout = opts.electionTimeout ?? 5;
    const nodeCount = opts.nodeCount ?? 5;
    this.nodes = Array.from({ length: nodeCount }, (_, id) => new BNode(id));
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodes.length) {
      throw new InvalidNodeError(id);
    }
  }

  startElection(id: number): void {
    this.checkId(id);
    const node = this.nodes[id];
    if (!node.online) {
      throw new OfflineError(id);
    }
    node.state = "electing";
    node.gotOk = false;
    node.electionDeadline = this.clock.now() + this.electionTimeout;

    let hasHigher = false;
    for (let j = id + 1; j < this.nodes.length; j++) {
      if (this.nodes[j].online) {
        hasHigher = true;
        this.deliver(id, { type: "election", from: id }, j);
      }
    }
    if (!hasHigher) {
      this.becomeCoordinator(id);
    }
  }

  tick(): void {
    this.clock.advance(1);
    const now = this.clock.now();
    const due = this.nodes
      .filter(
        (n) =>
          n.online &&
          n.state === "electing" &&
          now >= n.electionDeadline,
      )
      .sort((a, b) => b.id - a.id);
    for (const node of due) {
      if (!node.online || node.state !== "electing") continue;
      if (node.gotOk) {
        this.startElection(node.id);
      } else {
        this.becomeCoordinator(node.id);
      }
    }
  }

  setOnline(id: number, online: boolean): void {
    this.checkId(id);
    const node = this.nodes[id];
    if (node.online === online) return;
    node.online = online;
    if (!online) {
      if (node.state === "leading") {
        for (const other of this.nodes) {
          if (other.online && other.leader === id) {
            other.leader = null;
          }
        }
      }
      node.state = "idle";
      node.leader = null;
      node.gotOk = false;
    }
  }

  leaderOf(id: number): number | null {
    this.checkId(id);
    return this.nodes[id].leader;
  }

  state(id: number): NodeState {
    this.checkId(id);
    return this.nodes[id].state;
  }

  isOnline(id: number): boolean {
    this.checkId(id);
    return this.nodes[id].online;
  }

  coordinator(): number | null {
    const leaders = this.nodes.filter(
      (n) => n.online && n.state === "leading",
    );
    return leaders.length === 1 ? leaders[0].id : null;
  }

  private deliver(from: number, msg: Msg, to: number): void {
    const target = this.nodes[to];
    if (!target.online) return;
    switch (msg.type) {
      case "election":
        this.handleElection(from, to);
        break;
      case "ok":
        this.handleOk(to);
        break;
      case "coordinator":
        this.handleCoordinator(msg.leaderId, to);
        break;
    }
  }

  private handleElection(from: number, to: number): void {
    const receiver = this.nodes[to];
    this.deliver(to, { type: "ok", from: to }, from);
    if (receiver.state === "electing") return;
    this.startElection(to);
  }

  private handleOk(to: number): void {
    const node = this.nodes[to];
    if (node.state === "electing") {
      node.gotOk = true;
    }
  }

  private handleCoordinator(leaderId: number, to: number): void {
    const node = this.nodes[to];
    node.leader = leaderId;
    node.gotOk = false;
    node.state = to === leaderId ? "leading" : "idle";
  }

  private becomeCoordinator(id: number): void {
    const node = this.nodes[id];
    node.state = "leading";
    node.leader = id;
    node.gotOk = false;
    for (const other of this.nodes) {
      if (other.id !== id && other.online) {
        this.deliver(id, { type: "coordinator", leaderId: id }, other.id);
      }
    }
  }
}
