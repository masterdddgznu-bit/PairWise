import type { HandoffView } from "./types.js";
import { HandoffError } from "./errors.js";

export type HandoffRecord = {
  moveId: string;
  vnode: number;
  from: string;
  to: string;
  phase: "proposed" | "prepared";
  deadline: number | null;
};

export class HandoffBook {
  private readonly byId = new Map<string, HandoffRecord>();
  private readonly byVNode = new Map<number, string>();
  private seq = 0;

  propose(
    vnode: number,
    from: string,
    to: string,
    deadline: number | null,
  ): string {
    if (this.byVNode.has(vnode)) {
      throw new HandoffError(`vnode ${vnode} already has an active handoff`);
    }
    this.seq += 1;
    const moveId = `move-${this.seq}`;
    const record: HandoffRecord = {
      moveId,
      vnode,
      from,
      to,
      phase: "proposed",
      deadline,
    };
    this.byId.set(moveId, record);
    this.byVNode.set(vnode, moveId);
    return moveId;
  }
  private mustGet(moveId: string): HandoffRecord {
    const record = this.byId.get(moveId);
    if (!record) throw new HandoffError(`unknown moveId: ${moveId}`);
    return record;
  }
  prepare(moveId: string): HandoffRecord {
    const record = this.mustGet(moveId);
    if (record.phase !== "proposed") {
      throw new HandoffError(`handoff ${moveId} is not in proposed phase`);
    }
    record.phase = "prepared";
    return record;
  }
  commit(moveId: string): {
    vnode: number;
    from: string;
    to: string;
  } {
    const record = this.mustGet(moveId);
    this.byId.delete(moveId);
    this.byVNode.delete(record.vnode);
    return { vnode: record.vnode, from: record.from, to: record.to };
  }
  abort(moveId: string): { vnode: number } {
    const record = this.mustGet(moveId);
    this.byId.delete(moveId);
    this.byVNode.delete(record.vnode);
    return { vnode: record.vnode };
  }
  view(vnode: number): HandoffView | undefined {
    const moveId = this.byVNode.get(vnode);
    if (moveId === undefined) return undefined;
    const record = this.byId.get(moveId)!;
    return {
      moveId: record.moveId,
      from: record.from,
      to: record.to,
      phase: record.phase,
    };
  }
  get(moveId: string): HandoffRecord | undefined {
    return this.byId.get(moveId);
  }
  expired(now: number): string[] {
    const out: string[] = [];
    for (const record of this.byId.values()) {
      if (record.deadline !== null && now >= record.deadline) {
        out.push(record.moveId);
      }
    }
    return out.sort();
  }
  activeVNode(vnode: number): boolean {
    return this.byVNode.has(vnode);
  }
}
