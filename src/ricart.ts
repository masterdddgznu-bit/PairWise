import { VirtualClock } from "./clock.js";
import { InvalidNodeError, InvalidStateError, OfflineError } from "./errors.js";
import { cmpRequest, onReceive, tick } from "./lamport.js";
import { RNode } from "./node.js";
import type { NodeState, OpStatus } from "./types.js";

export type RicartOptions = {
  clock: VirtualClock;
  nodeCount?: number;
};

export class Ricart {
  readonly clock: VirtualClock;
  private readonly nodes: RNode[];
  private readonly operations = new Map<string, OpStatus>();
  private nextOpNumber = 1;

  constructor(opts: RicartOptions) {
    this.clock = opts.clock;
    const nodeCount = opts.nodeCount ?? 3;
    if (!Number.isInteger(nodeCount) || nodeCount < 1) {
      throw new RangeError(`nodeCount must be a positive integer: ${nodeCount}`);
    }
    this.nodes = Array.from({ length: nodeCount }, (_, id) => new RNode(id));
  }

  request(id: number): string {
    const node = this.getNode(id);
    if (!node.online) {
      throw new OfflineError(id);
    }
    if (node.state !== "idle") {
      throw new InvalidStateError(`node ${id} is ${node.state}`);
    }

    const opId = String(this.nextOpNumber++);
    node.opId = opId;
    node.clock = tick(node.clock);
    node.reqClock = node.clock;
    node.state = "waiting";
    this.operations.set(opId, "waiting");

    const targets = this.nodes.filter((candidate) => candidate.id !== id && candidate.online);
    node.awaiting = new Set(targets.map((target) => target.id));

    if (targets.length === 0) {
      this.holdIfReady(node);
    } else {
      for (const target of targets) {
        this.deliverRequest(target, node.id, node.reqClock);
      }
    }

    return opId;
  }

  exit(id: number): void {
    const node = this.getNode(id);
    if (node.state !== "holding") {
      throw new InvalidStateError(`node ${id} is ${node.state}`);
    }

    const opId = node.opId;
    const deferredRecipients = node.sortedDeferred();
    node.state = "idle";
    node.reqClock = 0;
    node.opId = null;
    if (opId !== null) {
      this.operations.set(opId, "done");
    }

    if (node.online) {
      for (const recipientId of deferredRecipients) {
        if (this.nodes[recipientId].online) {
          this.sendReply(node, recipientId);
        }
      }
    }
    node.deferred.clear();
  }

  setOnline(id: number, online: boolean): void {
    const node = this.getNode(id);
    if (node.online === online) {
      return;
    }

    node.online = online;
    if (!online) {
      for (const candidate of this.nodes) {
        if (candidate.id === id || candidate.state !== "waiting") {
          continue;
        }
        if (candidate.awaiting.delete(id)) {
          this.holdIfReady(candidate);
        }
      }
    }
  }

  state(id: number): NodeState {
    return this.getNode(id).state;
  }

  clockOf(id: number): number {
    return this.getNode(id).clock;
  }

  isOnline(id: number): boolean {
    return this.getNode(id).online;
  }

  deferred(id: number): number[] {
    return this.getNode(id).sortedDeferred();
  }

  status(opId: string): OpStatus {
    return this.operations.get(opId) ?? "unknown";
  }

  holder(): number | null {
    const holders = this.nodes.filter((node) => node.state === "holding");
    return holders.length === 1 ? holders[0].id : null;
  }

  private getNode(id: number): RNode {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodes.length) {
      throw new InvalidNodeError(id);
    }
    return this.nodes[id];
  }

  private deliverRequest(receiver: RNode, fromId: number, timestamp: number): void {
    receiver.clock = onReceive(receiver.clock, timestamp);

    if (receiver.state === "idle") {
      this.sendReply(receiver, fromId);
      return;
    }

    if (receiver.state === "holding") {
      receiver.deferred.add(fromId);
      return;
    }

    if (cmpRequest(timestamp, fromId, receiver.reqClock, receiver.id) < 0) {
      this.sendReply(receiver, fromId);
    } else {
      receiver.deferred.add(fromId);
    }
  }

  private sendReply(sender: RNode, recipientId: number): void {
    if (!sender.online) {
      return;
    }
    const recipient = this.nodes[recipientId];
    if (!recipient.online) {
      return;
    }

    sender.clock = tick(sender.clock);
    this.deliverReply(recipient, sender.id, sender.clock);
  }

  private deliverReply(receiver: RNode, fromId: number, timestamp: number): void {
    receiver.clock = onReceive(receiver.clock, timestamp);
    if (receiver.state === "waiting" && receiver.awaiting.delete(fromId)) {
      this.holdIfReady(receiver);
    }
  }

  private holdIfReady(node: RNode): void {
    if (node.state === "waiting" && node.awaiting.size === 0) {
      node.state = "holding";
      if (node.opId !== null) {
        this.operations.set(node.opId, "holding");
      }
    }
  }
}
