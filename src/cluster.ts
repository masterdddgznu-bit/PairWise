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

interface DoViewChangeReply {
  nodeId: string;
  view: number;
  log: LogEntry[];
  opNum: number;
  commitNum: number;
  lastNormalView: number;
}

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

function copyLog(log: LogEntry[]): LogEntry[] {
  return log.map((entry) => ({ ...entry }));
}

/**
 * 进程内 Viewstamped Replication 集群，用同步调用模拟协议消息。
 */
export class Cluster {
  private readonly nodeIds: string[];
  private readonly nodes = new Map<string, NodeState>();
  private readonly quorum: number;

  constructor(nodeIds: string[]) {
    if (nodeIds.length < 3 || nodeIds.length % 2 === 0) {
      throw new Error("nodeIds length must be odd and >= 3");
    }
    if (new Set(nodeIds).size !== nodeIds.length) {
      throw new Error("nodeIds must be unique");
    }
    this.nodeIds = [...nodeIds];
    this.quorum = Math.floor(nodeIds.length / 2) + 1;
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

  private node(id: string): NodeState {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`unknown node: ${id}`);
    }
    return node;
  }

  private installedView(): number {
    let normalMax = -1;
    let allMax = 0;
    for (const node of this.nodes.values()) {
      if (node.view > allMax) allMax = node.view;
      if (node.mode === "normal" && node.view > normalMax) normalMax = node.view;
    }
    return normalMax >= 0 ? normalMax : allMax;
  }

  primary(): string | null {
    const id = this.nodeIds[this.installedView() % this.nodeIds.length];
    const node = this.nodes.get(id)!;
    return node.up && node.mode === "normal" ? id : null;
  }

  private prepare(
    node: NodeState,
    view: number,
    opNum: number,
    entry: LogEntry,
    prefix: LogEntry[],
    commitNum: number,
  ): boolean {
    if (node.mode !== "normal" || node.view !== view) return false;
    const required = [...prefix, entry];
    for (let i = 0; i < required.length; i++) {
      const local = node.log[i];
      if (
        local &&
        (local.command !== required[i].command || local.view !== required[i].view)
      ) {
        return false;
      }
    }
    for (let i = 0; i < required.length; i++) {
      if (!node.log[i]) node.log.push({ ...required[i] });
    }
    node.opNum = Math.max(node.opNum, node.log.length);
    node.commitNum = Math.min(Math.max(node.commitNum, commitNum), node.log.length);
    return true;
  }

  propose(command: string): number {
    const primaryId = this.primary();
    if (primaryId === null) {
      throw new Error("no available primary");
    }
    const primary = this.nodes.get(primaryId)!;
    primary.opNum += 1;
    const entry: LogEntry = { view: primary.view, opNum: primary.opNum, command };
    primary.log.push(entry);
    const prefix = copyLog(primary.log.slice(0, -1));
    let oks = 1;
    for (const node of this.nodes.values()) {
      if (node.id === primaryId || !node.up) continue;
      if (this.prepare(node, primary.view, primary.opNum, entry, prefix, primary.commitNum)) {
        oks += 1;
      }
    }
    if (oks < this.quorum) {
      throw new Error("failed to replicate command to a quorum");
    }
    primary.commitNum = Math.max(primary.commitNum, primary.opNum);
    for (const node of this.nodes.values()) {
      if (!node.up) continue;
      node.commitNum = Math.min(Math.max(node.commitNum, primary.opNum), node.log.length);
    }
    return primary.opNum;
  }

  fail(id: string): void {
    this.node(id).up = false;
  }

  recover(id: string): void {
    const node = this.node(id);
    node.up = true;
    let best: NodeState | null = null;
    for (const other of this.nodes.values()) {
      if (other.id === id || !other.up) continue;
      if (other.mode !== "normal" || other.view < node.view) continue;
      if (
        !best ||
        other.view > best.view ||
        (other.view === best.view && other.opNum > best.opNum)
      ) {
        best = other;
      }
    }
    if (best) {
      node.view = best.view;
      node.log = copyLog(best.log);
      node.opNum = best.opNum;
      node.commitNum = best.commitNum;
      node.mode = "normal";
    }
  }

  requestViewChange(id: string): void {
    const initiator = this.node(id);
    if (!initiator.up) {
      throw new Error(`node is down: ${id}`);
    }
    const v = this.installedView() + 1;
    const replies: DoViewChangeReply[] = [];
    const touched: { node: NodeState; lastTried: number; mode: Mode }[] = [];
    for (const node of this.nodes.values()) {
      if (!node.up || node.lastTried >= v) continue;
      touched.push({ node, lastTried: node.lastTried, mode: node.mode });
      if (node.mode === "normal") {
        node.lastNormalView = node.view;
      }
      node.lastTried = v;
      node.mode = "view-change";
      replies.push({
        nodeId: node.id,
        view: node.view,
        log: copyLog(node.log),
        opNum: node.opNum,
        commitNum: node.commitNum,
        lastNormalView: node.lastNormalView,
      });
    }
    if (replies.length < this.quorum) {
      for (const { node, lastTried, mode } of touched) {
        node.lastTried = lastTried;
        node.mode = mode;
      }
      throw new Error("view change failed: insufficient do-view-change replies");
    }
    let best = replies[0];
    for (const reply of replies) {
      if (
        reply.lastNormalView > best.lastNormalView ||
        (reply.lastNormalView === best.lastNormalView && reply.opNum > best.opNum) ||
        (reply.lastNormalView === best.lastNormalView &&
          reply.opNum === best.opNum &&
          reply.nodeId < best.nodeId)
      ) {
        best = reply;
      }
    }
    const newPrimary = this.nodes.get(this.nodeIds[v % this.nodeIds.length])!;
    const maxCommit = Math.max(...replies.map((reply) => reply.commitNum));
    newPrimary.log = copyLog(best.log);
    newPrimary.opNum = best.opNum;
    newPrimary.view = v;
    newPrimary.commitNum = Math.max(newPrimary.commitNum, maxCommit);
    newPrimary.mode = "normal";
    for (const node of this.nodes.values()) {
      if (!node.up) continue;
      node.view = v;
      node.log = copyLog(newPrimary.log);
      node.opNum = newPrimary.opNum;
      node.commitNum = Math.max(node.commitNum, newPrimary.commitNum);
      node.mode = "normal";
    }
  }

  committed(id: string): string[] {
    const node = this.node(id);
    return node.log
      .filter((entry) => entry.opNum <= node.commitNum)
      .sort((a, b) => a.opNum - b.opNum)
      .map((entry) => entry.command);
  }

  status(id: string): NodeStatus {
    const node = this.node(id);
    return {
      view: node.view,
      opNum: node.opNum,
      commitNum: node.commitNum,
      up: node.up,
      mode: node.mode,
    };
  }

  stats(): ClusterStats {
    const primary = this.primary();
    let up = 0;
    for (const node of this.nodes.values()) {
      if (node.up) up += 1;
    }
    return {
      view: this.installedView(),
      primary,
      up,
      committed: primary === null ? 0 : this.nodes.get(primary)!.commitNum,
    };
  }
}
