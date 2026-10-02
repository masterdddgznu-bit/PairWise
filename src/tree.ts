import { RbError } from "./errors.js";
import { RbNode, allocateId } from "./node.js";
import { insertFixup } from "./insert_fixup.js";
import { deleteFixup } from "./delete_fixup.js";
import type { RbHandle, RbStats, RbTreeState } from "./types.js";

/** Deterministic Red-Black ordered map (CLRS). */
export class RbTree {
  private readonly handle: RbHandle = { root: null };
  private count = 0;
  private nextId = 1;
  private frozen = false;

  private assertMutable(): void {
    if (this.frozen) throw new RbError("RbTree is frozen");
  }

  private findNode(key: string): RbNode | null {
    let cur = this.handle.root;
    while (cur !== null) {
      if (key === cur.key) return cur;
      cur = key < cur.key ? cur.left : cur.right;
    }
    return null;
  }

  set(key: string, value: number): void {
    this.assertMutable();
    let parent: RbNode | null = null;
    let cur = this.handle.root;
    while (cur !== null) {
      parent = cur;
      if (key === cur.key) {
        cur.value = value;
        return;
      }
      cur = key < cur.key ? cur.left : cur.right;
    }
    const id = allocateId(this.nextId);
    this.nextId = id + 1;
    const node = new RbNode(id, key, value);
    node.parent = parent;
    if (parent === null) {
      this.handle.root = node;
    } else if (key < parent.key) {
      parent.left = node;
    } else {
      parent.right = node;
    }
    insertFixup(this.handle, node);
    this.count += 1;
  }

  get(key: string): number | undefined {
    return this.findNode(key)?.value;
  }

  has(key: string): boolean {
    return this.findNode(key) !== null;
  }

  private transplant(u: RbNode, v: RbNode | null): void {
    if (u.parent === null) {
      this.handle.root = v;
    } else if (u === u.parent.left) {
      u.parent.left = v;
    } else {
      u.parent.right = v;
    }
    if (v !== null) v.parent = u.parent;
  }

  delete(key: string): boolean {
    this.assertMutable();
    const z = this.findNode(key);
    if (z === null) return false;

    let y = z;
    let yOriginalColor = y.color;
    let x: RbNode | null;
    let xParent: RbNode | null;

    if (z.left === null) {
      x = z.right;
      xParent = z.parent;
      this.transplant(z, z.right);
    } else if (z.right === null) {
      x = z.left;
      xParent = z.parent;
      this.transplant(z, z.left);
    } else {
      y = z.right;
      while (y.left !== null) y = y.left;
      yOriginalColor = y.color;
      x = y.right;
      if (y.parent === z) {
        xParent = y;
      } else {
        xParent = y.parent;
        this.transplant(y, y.right);
        y.right = z.right;
        y.right.parent = y;
      }
      this.transplant(z, y);
      y.left = z.left;
      y.left.parent = y;
      y.color = z.color;
    }

    if (yOriginalColor === "black" && (x !== null || xParent !== null)) {
      deleteFixup(this.handle, x, xParent);
    }
    z.left = null;
    z.right = null;
    z.parent = null;
    this.count -= 1;
    return true;
  }

  size(): number {
    return this.count;
  }

  private static heightOf(node: RbNode | null): number {
    if (node === null) return 0;
    return 1 + Math.max(RbTree.heightOf(node.left), RbTree.heightOf(node.right));
  }

  height(): number {
    return RbTree.heightOf(this.handle.root);
  }

  blackHeight(): number {
    let bh = 0;
    let cur = this.handle.root;
    while (cur !== null) {
      if (cur.color === "black") bh += 1;
      cur = cur.left;
    }
    return bh;
  }

  keys(): string[] {
    const out: string[] = [];
    const stack: RbNode[] = [];
    let cur = this.handle.root;
    while (cur !== null || stack.length > 0) {
      while (cur !== null) {
        stack.push(cur);
        cur = cur.left;
      }
      cur = stack.pop()!;
      out.push(cur.key);
      cur = cur.right;
    }
    return out;
  }

  range(lo: string, hi: string): { key: string; value: number }[] {
    const out: { key: string; value: number }[] = [];
    const stack: RbNode[] = [];
    let cur = this.handle.root;
    while (cur !== null || stack.length > 0) {
      while (cur !== null) {
        if (cur.key >= lo) {
          stack.push(cur);
          cur = cur.left;
        } else {
          cur = cur.right;
        }
      }
      if (stack.length === 0) break;
      cur = stack.pop()!;
      if (cur.key > hi) break;
      out.push({ key: cur.key, value: cur.value });
      cur = cur.right;
    }
    return out;
  }

  exportState(): RbTreeState {
    const nodes: RbTreeState["nodes"] = [];
    const stack: RbNode[] = [];
    if (this.handle.root !== null) stack.push(this.handle.root);
    while (stack.length > 0) {
      const node = stack.pop()!;
      nodes.push({
        id: node.id,
        key: node.key,
        value: node.value,
        color: node.color,
        leftId: node.left === null ? null : node.left.id,
        rightId: node.right === null ? null : node.right.id,
        parentId: node.parent === null ? null : node.parent.id,
      });
      if (node.left !== null) stack.push(node.left);
      if (node.right !== null) stack.push(node.right);
    }
    nodes.sort((a, b) => a.id - b.id);
    return {
      frozen: this.frozen,
      rootId: this.handle.root === null ? null : this.handle.root.id,
      nextId: this.nextId,
      nodes,
    };
  }

  static fromState(state: RbTreeState): RbTree {
    const tree = new RbTree();
    const byId = new Map<number, RbNode>();
    for (const ns of state.nodes) {
      const node = new RbNode(ns.id, ns.key, ns.value);
      node.color = ns.color;
      byId.set(ns.id, node);
    }
    const link = (id: number | null): RbNode | null => {
      if (id === null) return null;
      const node = byId.get(id);
      if (node === undefined) throw new RbError("fromState: dangling node id");
      return node;
    };
    for (const ns of state.nodes) {
      const node = byId.get(ns.id)!;
      node.left = link(ns.leftId);
      node.right = link(ns.rightId);
      node.parent = link(ns.parentId);
    }
    tree.handle.root = link(state.rootId);
    tree.count = state.nodes.length;
    tree.nextId = state.nextId;
    tree.frozen = state.frozen;
    return tree;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): RbStats {
    let redCount = 0;
    let blackCount = 0;
    const stack: RbNode[] = [];
    if (this.handle.root !== null) stack.push(this.handle.root);
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.color === "red") redCount += 1;
      else blackCount += 1;
      if (node.left !== null) stack.push(node.left);
      if (node.right !== null) stack.push(node.right);
    }
    return {
      frozen: this.frozen,
      size: this.count,
      height: this.height(),
      blackHeight: this.blackHeight(),
      nodeCount: redCount + blackCount,
      redCount,
      blackCount,
    };
  }
}
