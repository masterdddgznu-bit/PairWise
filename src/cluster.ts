export interface LogEntry {
  view: number;
  opNum: number;
  command: string;
}

export interface NodeStatus {
  view: number;
  opNum: number;
  commitNum: number;
  up: boolean;
  mode: "normal" | "view-change";
}

export interface ClusterStats {
  view: number;
  primary: string | null;
  up: number;
  committed: number;
}

type Mode = "normal" | "view-change";

interface NodeState {
  id: string;
  view: number;
  opNum: number;
  log: LogEntry[];
  commitNum: number;
  up: boolean;
  mode: Mode;
  lastTried: number;
  lastNormalView: number;
}

interface PrepareMessage {
  view: number;
  opNum: number;
  entry: LogEntry;
  prefix: LogEntry[];
  commitNum: number;
}

interface DoViewChangeReply {
  nodeId: string;
  view: number;
  log: LogEntry[];
  opNum: number;
  commitNum: number;
  lastNormalView: number;
}

function cloneLog(log: LogEntry[]): LogEntry[] {
  return log.map((entry) => ({ ...entry }));
}

function entryMatches(a: LogEntry, b: LogEntry): boolean {
  return a.view === b.view && a.opNum === b.opNum && a.command === b.command;
}

/**
 * Viewstamped Replication 集群（进程内同步模拟）。
 */
export class Cluster {
  private readonly nodeIds: string[];
  private readonly quorumSize: number;
  private readonly nodes = new Map<string, NodeState>();

  constructor(nodeIds: string[]) {
    if (nodeIds.length < 3 || nodeIds.length % 2 === 0) {
      throw new Error("nodeIds length must be odd and >= 3");
    }
    this.nodeIds = [...nodeIds];
    this.quorumSize = Math.floor(nodeIds.length / 2) + 1;
    for (const id of nodeIds) {
      this.nodes.set(id, {
        id,
        view: 0,
        opNum: 0,
        log: [],
        commitNum: 0,
        up: true,
        mode: "normal",
        lastTried: 0,
        lastNormalView: 0,
      });
    }
  }

  primary(): string | null {
    const id = this.nodeIds[this.installedView() % this.nodeIds.length];
    const node = this.nodes.get(id);
    if (node && node.up && node.mode === "normal") {
      return id;
    }
    return null;
  }

  propose(command: string): number {
    const primaryId = this.primary();
    if (primaryId === null) {
      throw new Error("no available primary");
    }
    const leader = this.mustGet(primaryId);
    leader.opNum += 1;
    const entry: LogEntry = { view: leader.view, opNum: leader.opNum, command };
    leader.log.push({ ...entry });
    const message: PrepareMessage = {
      view: leader.view,
      opNum: leader.opNum,
      entry,
      prefix: cloneLog(leader.log.slice(0, -1)),
      commitNum: leader.commitNum,
    };
    let oks = 1;
    for (const node of this.nodes.values()) {
      if (node.id === leader.id || !node.up) {
        continue;
      }
      if (this.handlePrepare(node, message)) {
        oks += 1;
      }
    }
    if (oks < this.quorumSize) {
      throw new Error("prepare did not reach a quorum");
    }
    leader.commitNum = leader.opNum;
    for (const node of this.nodes.values()) {
      if (!node.up) {
        continue;
      }
      node.commitNum = Math.max(node.commitNum, Math.min(leader.opNum, node.log.length));
    }
    return leader.opNum;
  }

  fail(id: string): void {
    this.mustGet(id).up = false;
  }

  recover(id: string): void {
    const node = this.mustGet(id);
    node.up = true;
    let best: NodeState | null = null;
    for (const other of this.nodes.values()) {
      if (other.id === id || !other.up || other.mode !== "normal") {
        continue;
      }
      if (other.view < node.view) {
        continue;
      }
      if (
        best === null ||
        other.view > best.view ||
        (other.view === best.view && other.opNum > best.opNum)
      ) {
        best = other;
      }
    }
    if (best !== null) {
      node.view = best.view;
      node.log = cloneLog(best.log);
      node.opNum = best.opNum;
      node.commitNum = best.commitNum;
      node.mode = "normal";
    }
  }

  requestViewChange(id: string): void {
    const initiator = this.mustGet(id);
    if (!initiator.up) {
      throw new Error(`node ${id} is not up`);
    }
    const targetView = this.installedView() + 1;
    const accepted: {
      node: NodeState;
      lastTried: number;
      mode: Mode;
      lastNormalView: number;
    }[] = [];
    const replies: DoViewChangeReply[] = [];
    for (const node of this.nodes.values()) {
      if (!node.up || node.lastTried >= targetView) {
        continue;
      }
      accepted.push({
        node,
        lastTried: node.lastTried,
        mode: node.mode,
        lastNormalView: node.lastNormalView,
      });
      if (node.mode === "normal") {
        node.lastNormalView = node.view;
      }
      node.lastTried = targetView;
      node.mode = "view-change";
      replies.push({
        nodeId: node.id,
        view: node.view,
        log: cloneLog(node.log),
        opNum: node.opNum,
        commitNum: node.commitNum,
        lastNormalView: node.lastNormalView,
      });
    }
    if (replies.length < this.quorumSize) {
      for (const record of accepted) {
        record.node.lastTried = record.lastTried;
        record.node.mode = record.mode;
        record.node.lastNormalView = record.lastNormalView;
      }
      throw new Error("view change did not reach a quorum");
    }
    let best = replies[0];
    for (const reply of replies.slice(1)) {
      if (
        reply.lastNormalView > best.lastNormalView ||
        (reply.lastNormalView === best.lastNormalView &&
          (reply.opNum > best.opNum ||
            (reply.opNum === best.opNum && reply.nodeId < best.nodeId)))
      ) {
        best = reply;
      }
    }
    const newLog = cloneLog(best.log);
    const newOpNum = best.opNum;
    const maxCommit = Math.max(...replies.map((reply) => reply.commitNum));
    const newPrimary = this.mustGet(this.nodeIds[targetView % this.nodeIds.length]);
    newPrimary.view = targetView;
    newPrimary.log = cloneLog(newLog);
    newPrimary.opNum = newOpNum;
    newPrimary.commitNum = Math.min(
      Math.max(newPrimary.commitNum, maxCommit),
      newPrimary.log.length,
    );
    newPrimary.mode = "normal";
    for (const node of this.nodes.values()) {
      if (!node.up || node.id === newPrimary.id) {
        continue;
      }
      node.view = targetView;
      node.log = cloneLog(newLog);
      node.opNum = newOpNum;
      node.commitNum = Math.min(
        Math.max(node.commitNum, newPrimary.commitNum),
        node.log.length,
      );
      node.mode = "normal";
    }
  }

  committed(id: string): string[] {
    const node = this.mustGet(id);
    return node.log
      .filter((entry) => entry.opNum <= node.commitNum)
      .sort((a, b) => a.opNum - b.opNum)
      .map((entry) => entry.command);
  }

  status(id: string): NodeStatus {
    const node = this.mustGet(id);
    return {
      view: node.view,
      opNum: node.opNum,
      commitNum: node.commitNum,
      up: node.up,
      mode: node.mode,
    };
  }

  stats(): ClusterStats {
    const primaryId = this.primary();
    let up = 0;
    for (const node of this.nodes.values()) {
      if (node.up) {
        up += 1;
      }
    }
    return {
      view: this.installedView(),
      primary: primaryId,
      up,
      committed: primaryId === null ? 0 : this.mustGet(primaryId).commitNum,
    };
  }

  private mustGet(id: string): NodeState {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`unknown node: ${id}`);
    }
    return node;
  }

  private installedView(): number {
    let maxNormal = -1;
    let maxAll = 0;
    for (const node of this.nodes.values()) {
      if (node.mode === "normal") {
        maxNormal = Math.max(maxNormal, node.view);
      }
      maxAll = Math.max(maxAll, node.view);
    }
    return maxNormal >= 0 ? maxNormal : maxAll;
  }

  private handlePrepare(node: NodeState, message: PrepareMessage): boolean {
    if (node.mode !== "normal" || node.view !== message.view) {
      return false;
    }
    for (let i = 0; i < message.prefix.length; i += 1) {
      const local = node.log[i];
      if (local !== undefined && !entryMatches(local, message.prefix[i])) {
        return false;
      }
    }
    const existing = node.log[message.opNum - 1];
    if (existing !== undefined && !entryMatches(existing, message.entry)) {
      return false;
    }
    node.log = [...cloneLog(message.prefix), { ...message.entry }];
    node.opNum = message.opNum;
    node.commitNum = Math.max(node.commitNum, Math.min(message.commitNum, node.opNum));
    return true;
  }
}
