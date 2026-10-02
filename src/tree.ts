import { rebalanceAfterDelete } from "./delete_rebalance.js";
import { AvlError } from "./errors.js";
import { rebalanceAfterInsert } from "./insert_rebalance.js";
import { AvlNode, allocateId } from "./node.js";
import { heightOf } from "./rotate.js";
import type { AvlNodeState, AvlStats, AvlTreeState } from "./types.js";

/** Deterministic AVL ordered map — starter stub. */
export class AvlTree {
  private root: AvlNode | null = null;
  private count = 0;
  private nextId = 1;
  private frozen = false;

  set(key: string, value: number): void {
    this.assertMutable();
    this.root = this.insertInto(this.root, key, value);
  }

  private insertInto(node: AvlNode | null, key: string, value: number): AvlNode {
    if (node === null) {
      const created = new AvlNode(allocateId(this.nextId), key, value);
      this.nextId += 1;
      this.count += 1;
      return created;
    }
    if (key < node.key) {
      node.left = this.insertInto(node.left, key, value);
    } else if (key > node.key) {
      node.right = this.insertInto(node.right, key, value);
    } else {
      node.value = value;
      return node;
    }
    return rebalanceAfterInsert(node);
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
      if (key < node.key) {
        node = node.left;
      } else if (key > node.key) {
        node = node.right;
      } else {
        return node;
      }
    }
    return null;
  }

  delete(key: string): boolean {
    this.assertMutable();
    if (this.find(key) === null) {
      return false;
    }
    this.root = this.deleteFrom(this.root, key);
    this.count -= 1;
    return true;
  }

  private deleteFrom(node: AvlNode | null, key: string): AvlNode | null {
    if (node === null) {
      return null;
    }
    if (key < node.key) {
      node.left = this.deleteFrom(node.left, key);
    } else if (key > node.key) {
      node.right = this.deleteFrom(node.right, key);
    } else if (node.left === null) {
      return node.right;
    } else if (node.right === null) {
      return node.left;
    } else {
      const successor = this.minNode(node.right);
      node.key = successor.key;
      node.value = successor.value;
      node.right = this.deleteFrom(node.right, successor.key);
    }
    return rebalanceAfterDelete(node);
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
    const walk = (node: AvlNode | null): void => {
      if (node === null) {
        return;
      }
      if (node.key > lo) {
        walk(node.left);
      }
      if (node.key >= lo && node.key <= hi) {
        out.push({ key: node.key, value: node.value });
      }
      if (node.key < hi) {
        walk(node.right);
      }
    };
    walk(this.root);
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
    this.inorder(this.root, (node) => {
      nodes.push({
        id: node.id,
        key: node.key,
        value: node.value,
        height: node.height,
        leftId: node.left === null ? null : node.left.id,
        rightId: node.right === null ? null : node.right.id,
      });
    });
    nodes.sort((a, b) => a.id - b.id);
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
      byId.set(nodeState.id, node);
    }
    const link = (id: number | null): AvlNode | null => {
      if (id === null) {
        return null;
      }
      const node = byId.get(id);
      if (node === undefined) {
        throw new AvlError(`fromState: unknown node id ${id}`);
      }
      return node;
    };
    for (const nodeState of state.nodes) {
      const node = byId.get(nodeState.id);
      if (node === undefined) {
        throw new AvlError(`fromState: duplicate node id ${nodeState.id}`);
      }
      node.left = link(nodeState.leftId);
      node.right = link(nodeState.rightId);
    }
    tree.root = link(state.rootId);
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
