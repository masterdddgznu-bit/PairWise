import { AvlError } from "./errors.js";
import { AvlNode, allocateId } from "./node.js";
import { heightOf } from "./rotate.js";
import { rebalanceAfterInsert } from "./insert_rebalance.js";
import { rebalanceAfterDelete } from "./delete_rebalance.js";
import type { AvlNodeState, AvlStats, AvlTreeState } from "./types.js";

/** Deterministic AVL ordered map. */
export class AvlTree {
  private root: AvlNode | null = null;
  private count = 0;
  private nextId = 1;
  private frozen = false;

  set(key: string, value: number): void {
    this.assertMutable();
    const result = this.insert(this.root, key, value);
    this.root = result.node;
    if (result.inserted) {
      this.count += 1;
    }
  }

  private insert(
    node: AvlNode | null,
    key: string,
    value: number,
  ): { node: AvlNode; inserted: boolean } {
    if (node === null) {
      const created = new AvlNode(allocateId(this.nextId), key, value);
      this.nextId += 1;
      return { node: created, inserted: true };
    }
    if (key === node.key) {
      node.value = value;
      return { node, inserted: false };
    }
    let inserted: boolean;
    if (key < node.key) {
      const result = this.insert(node.left, key, value);
      node.left = result.node;
      inserted = result.inserted;
    } else {
      const result = this.insert(node.right, key, value);
      node.right = result.node;
      inserted = result.inserted;
    }
    if (!inserted) {
      return { node, inserted };
    }
    return { node: rebalanceAfterInsert(node), inserted };
  }

  get(key: string): number | undefined {
    const node = this.find(key);
    return node === null ? undefined : node.value;
  }

  has(key: string): boolean {
    return this.find(key) !== null;
  }

  private find(key: string): AvlNode | null {
    let node = this.root;
    while (node !== null) {
      if (key === node.key) {
        return node;
      }
      node = key < node.key ? node.left : node.right;
    }
    return null;
  }

  delete(key: string): boolean {
    this.assertMutable();
    const result = this.remove(this.root, key);
    this.root = result.node;
    if (result.deleted) {
      this.count -= 1;
    }
    return result.deleted;
  }

  private remove(
    node: AvlNode | null,
    key: string,
  ): { node: AvlNode | null; deleted: boolean } {
    if (node === null) {
      return { node: null, deleted: false };
    }
    let deleted: boolean;
    if (key < node.key) {
      const result = this.remove(node.left, key);
      node.left = result.node;
      deleted = result.deleted;
    } else if (key > node.key) {
      const result = this.remove(node.right, key);
      node.right = result.node;
      deleted = result.deleted;
    } else {
      deleted = true;
      if (node.left === null) {
        return { node: node.right, deleted };
      }
      if (node.right === null) {
        return { node: node.left, deleted };
      }
      const successor = this.minNode(node.right);
      node.key = successor.key;
      node.value = successor.value;
      const result = this.remove(node.right, successor.key);
      node.right = result.node;
    }
    if (!deleted) {
      return { node, deleted };
    }
    return { node: rebalanceAfterDelete(node), deleted };
  }

  private minNode(node: AvlNode): AvlNode {
    let current = node;
    while (current.left !== null) {
      current = current.left;
    }
    return current;
  }

  size(): number {
    return this.count;
  }

  height(): number {
    return heightOf(this.root);
  }

  keys(): string[] {
    const out: string[] = [];
    this.inorder(this.root, (node) => out.push(node.key));
    return out;
  }

  range(lo: string, hi: string): { key: string; value: number }[] {
    const out: { key: string; value: number }[] = [];
    const visit = (node: AvlNode | null): void => {
      if (node === null) {
        return;
      }
      if (node.key > lo) {
        visit(node.left);
      }
      if (node.key >= lo && node.key <= hi) {
        out.push({ key: node.key, value: node.value });
      }
      if (node.key < hi) {
        visit(node.right);
      }
    };
    visit(this.root);
    return out;
  }

  private inorder(node: AvlNode | null, visit: (node: AvlNode) => void): void {
    if (node === null) {
      return;
    }
    this.inorder(node.left, visit);
    visit(node);
    this.inorder(node.right, visit);
  }

  exportState(): AvlTreeState {
    const nodes: AvlNodeState[] = [];
    this.inorder(this.root, (node) =>
      nodes.push({
        id: node.id,
        key: node.key,
        value: node.value,
        height: node.height,
        leftId: node.left === null ? null : node.left.id,
        rightId: node.right === null ? null : node.right.id,
      }),
    );
    return {
      frozen: this.frozen,
      rootId: this.root === null ? null : this.root.id,
      nextId: this.nextId,
      nodes,
    };
  }

  static fromState(state: AvlTreeState): AvlTree {
    const tree = new AvlTree();
    const byId = new Map<number, AvlNode>();
    for (const nodeState of state.nodes) {
      const node = new AvlNode(nodeState.id, nodeState.key, nodeState.value);
      node.height = nodeState.height;
      byId.set(node.id, node);
    }
    for (const nodeState of state.nodes) {
      const node = byId.get(nodeState.id);
      if (node === undefined) {
        throw new AvlError("fromState: inconsistent node table");
      }
      node.left = nodeState.leftId === null ? null : (byId.get(nodeState.leftId) ?? null);
      node.right = nodeState.rightId === null ? null : (byId.get(nodeState.rightId) ?? null);
    }
    tree.root = state.rootId === null ? null : (byId.get(state.rootId) ?? null);
    tree.count = state.nodes.length;
    tree.nextId = state.nextId;
    tree.frozen = state.frozen;
    return tree;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): AvlStats {
    return {
      frozen: this.frozen,
      size: this.count,
      height: this.height(),
      nodeCount: this.count,
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new AvlError("AvlTree is frozen");
    }
  }
}
