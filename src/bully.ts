import { VirtualClock } from "./clock.js";
import { InvalidNodeError, OfflineError } from "./errors.js";
import type { CoordinatorMsg, ElectionMsg, Msg, OkMsg } from "./messages.js";
import { BNode } from "./node.js";
import type { NodeState } from "./types.js";

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
    const nodeCount = opts.nodeCount ?? 5;
    this.electionTimeout = opts.electionTimeout ?? 5;
    this.nodes = Array.from({ length: nodeCount }, (_, id) => new BNode(id));
  }

  private requireNode(id: number): BNode {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodes.length) {
      throw new InvalidNodeError(id);
    }
    return this.nodes[id];
  }

  startElection(id: number): void {
    const node = this.requireNode(id);
    if (!node.online) {
      throw new OfflineError(id);
    }

    node.state = "electing";
    node.gotOk = false;
    node.electionDeadline = this.clock.now() + this.electionTimeout;

    let hasHigherOnline = false;
    for (let j = id + 1; j < this.nodes.length; j++) {
      const higher = this.nodes[j];
      if (higher.online) {
        hasHigherOnline = true;
        this.send({ type: "election", from: id }, j);
      }
    }

    if (!hasHigherOnline) {
      this.becomeCoordinator(node);
    }
  }

  tick(): void {
    this.clock.advance(1);
    const now = this.clock.now();

    const pending = this.nodes.filter(
      (node) =>
        node.online &&
        node.state === "electing" &&
        now >= node.electionDeadline,
    );

    for (const node of pending) {
      if (node.state !== "electing") {
        continue;
      }
      if (node.gotOk) {
        this.startElection(node.id);
      } else {
        this.becomeCoordinator(node);
      }
    }
  }

  setOnline(id: number, online: boolean): void {
    const node = this.requireNode(id);
    if (node.online === online) {
      return;
    }

    node.online = online;
    node.state = "idle";
    node.gotOk = false;

    if (!online) {
      for (const other of this.nodes) {
        if (other.online && other.leader === id) {
          other.leader = null;
        }
      }
      node.leader = null;
    } else {
      node.leader = null;
    }
  }

  leaderOf(id: number): number | null {
    return this.requireNode(id).leader;
  }

  state(id: number): NodeState {
    return this.requireNode(id).state;
  }

  isOnline(id: number): boolean {
    return this.requireNode(id).online;
  }

  coordinator(): number | null {
    const leaders = this.nodes.filter((node) => node.state === "leading");
    return leaders.length === 1 ? leaders[0].id : null;
  }

  private send(msg: Msg, toId: number): void {
    const target = this.nodes[toId];
    if (!target.online) {
      return;
    }
    switch (msg.type) {
      case "election":
        this.handleElection(target, msg);
        break;
      case "ok":
        this.handleOk(target, msg);
        break;
      case "coordinator":
        this.handleCoordinator(target, msg);
        break;
    }
  }

  private handleElection(target: BNode, msg: ElectionMsg): void {
    if (target.id <= msg.from) {
      return;
    }

    const sender = this.nodes[msg.from];
    if (sender.online) {
      const ok: OkMsg = { type: "ok", from: target.id };
      this.send(ok, sender.id);
    }

    this.startElection(target.id);
  }

  private handleOk(target: BNode, _msg: OkMsg): void {
    if (target.state === "electing") {
      target.gotOk = true;
    }
  }

  private handleCoordinator(target: BNode, msg: CoordinatorMsg): void {
    target.leader = msg.leaderId;
    target.state = target.id === msg.leaderId ? "leading" : "idle";
    target.gotOk = false;
  }

  private becomeCoordinator(node: BNode): void {
    node.state = "leading";
    node.leader = node.id;
    node.gotOk = false;

    for (const other of this.nodes) {
      if (other.id !== node.id && other.online) {
        this.send({ type: "coordinator", leaderId: node.id }, other.id);
      }
    }
  }
}
