import { VirtualClock } from "./clock.js";
import { RNode } from "./node.js";
import { cmpRequest, onReceive, tick } from "./lamport.js";
import {
  InvalidNodeError,
  InvalidStateError,
  OfflineError,
} from "./errors.js";
import type { NodeState, OpStatus } from "./types.js";

export type RicartOptions = {
  clock: VirtualClock;
  nodeCount?: number;
};

type OpRecord = {
  id: number;
  status: "waiting" | "holding" | "done";
};

export class Ricart {
  readonly clock: VirtualClock;
  private readonly nodes: RNode[];
  private nextOpSeq = 1;
  private readonly ops = new Map<string, OpRecord>();

  constructor(opts: RicartOptions) {
    this.clock = opts.clock;
    const nodeCount = opts.nodeCount ?? 3;
    if (!Number.isInteger(nodeCount) || nodeCount < 1) {
      throw new InvalidNodeError(nodeCount);
    }
    this.nodes = Array.from({ length: nodeCount }, (_, id) => new RNode(id));
  }

  private nodeOf(id: number): RNode {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodes.length) {
      throw new InvalidNodeError(id);
    }
    return this.nodes[id];
  }

  request(id: number): string {
    const node = this.nodeOf(id);
    if (node.state !== "idle") {
      throw new InvalidStateError(
        `node ${id} has a pending request or is in critical section`,
      );
    }
    if (!node.online) {
      throw new OfflineError(id);
    }

    const opId = String(this.nextOpSeq++);
    this.ops.set(opId, { id, status: "waiting" });

    node.clock = tick(node.clock);
    node.reqClock = node.clock;
    node.state = "waiting";
    node.opId = opId;

    const targets = this.nodes
      .filter((peer) => peer.id !== id && peer.online)
      .map((peer) => peer.id);
    node.awaiting = new Set(targets);

    for (const target of targets) {
      this.deliverRequest(this.nodes[target], node.reqClock, id);
    }

    if (node.awaiting.size === 0) {
      this.grant(node, opId);
    }
    return opId;
  }

  private deliverRequest(
    receiver: RNode,
    ts: number,
    from: number,
  ): void {
    if (!receiver.online) return;
    receiver.clock = onReceive(receiver.clock, ts);
    switch (receiver.state) {
      case "idle":
        this.sendReply(receiver, from);
        break;
      case "holding":
        receiver.deferred.add(from);
        break;
      case "waiting":
        if (cmpRequest(ts, from, receiver.reqClock, receiver.id) < 0) {
          this.sendReply(receiver, from);
        } else {
          receiver.deferred.add(from);
        }
        break;
    }
  }

  private deliverReply(requester: RNode, ts: number, from: number): void {
    if (!requester.online) return;
    requester.clock = onReceive(requester.clock, ts);
    requester.awaiting.delete(from);
    if (requester.state === "waiting" && requester.awaiting.size === 0) {
      if (requester.opId !== null) {
        this.grant(requester, requester.opId);
      }
    }
  }

  private sendReply(sender: RNode, to: number): void {
    const receiver = this.nodes[to];
    sender.clock = tick(sender.clock);
    this.deliverReply(receiver, sender.clock, sender.id);
  }

  private grant(node: RNode, opId: string): void {
    node.state = "holding";
    const op = this.ops.get(opId);
    if (op && op.id === node.id) {
      op.status = "holding";
    }
  }

  exit(id: number): void {
    const node = this.nodeOf(id);
    if (node.state !== "holding") {
      throw new InvalidStateError(
        `node ${id} cannot exit without holding the critical section`,
      );
    }

    const opId = node.opId;
    const replies = [...node.deferred].sort((a, b) => a - b);
    node.deferred.clear();
    for (const peerId of replies) {
      const peer = this.nodes[peerId];
      if (peer.online) {
        this.sendReply(node, peerId);
      }
    }

    node.state = "idle";
    node.reqClock = 0;
    node.awaiting.clear();
    node.opId = null;
    if (opId !== null) {
      const op = this.ops.get(opId);
      if (op && op.id === id) {
        op.status = "done";
      }
    }
  }

  setOnline(id: number, online: boolean): void {
    const node = this.nodeOf(id);
    node.online = online;
    if (!online) {
      for (const other of this.nodes) {
        if (other.id !== id && other.state === "waiting") {
          other.awaiting.delete(id);
          if (other.awaiting.size === 0 && other.opId !== null) {
            this.grant(other, other.opId);
          }
        }
      }
    }
  }

  state(id: number): NodeState {
    return this.nodeOf(id).state;
  }
  clockOf(id: number): number {
    return this.nodeOf(id).clock;
  }
  isOnline(id: number): boolean {
    return this.nodeOf(id).online;
  }
  deferred(id: number): number[] {
    return [...this.nodeOf(id).deferred].sort((a, b) => a - b);
  }
  status(opId: string): OpStatus {
    return this.ops.get(opId)?.status ?? "unknown";
  holder(): number | null { return null; }
}
