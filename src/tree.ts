import { rebalanceAfterDelete } from "./delete_rebalance.js";
import { BPlusError } from "./errors.js";
import { InternalNode } from "./internal.js";
import { LeafNode } from "./leaf.js";
import { allocateId, isLeafNode } from "./node.js";
import { splitAtIndex } from "./split.js";
import type { BPlusStats, BPlusTreeState } from "./types.js";

type AnyNode = LeafNode | InternalNode;

/** First index i with keys[i] >= key. */
function lowerBound(keys: string[], key: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Child index to descend into: count of separators <= key. */
function childIndex(keys: string[], key: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] <= key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Deterministic B+ tree ordered map. */
export class BPlusTree {
  private readonly order: number;
  private readonly leafMaxKeys: number;
  private readonly internalMaxKeys: number;
  private readonly nodes = new Map<number, AnyNode>();
  private root: AnyNode;
  private nextId = 0;
  private count = 0;
  private frozen = false;

  constructor(order: number) {
    if (!Number.isInteger(order) || order < 3 || order > 8) {
      throw new BPlusError(`invalid B+ tree order: ${order}`);
    }
    this.order = order;
    this.leafMaxKeys = order - 1;
    this.internalMaxKeys = order;
    this.root = new LeafNode(this.allocId());
    this.nodes.set(this.root.id, this.root);
  }

  set(key: string, value: number): void {
    this.assertMutable();
    const path: InternalNode[] = [];
    let node = this.root;
    while (!isLeafNode(node)) {
      path.push(node);
      node = this.getNode(node.children[childIndex(node.keys, key)]);
    }
    const leaf = node;
    const pos = lowerBound(leaf.keys, key);
    if (pos < leaf.keys.length && leaf.keys[pos] === key) {
      leaf.values[pos] = value;
      return;
    }
    leaf.keys.splice(pos, 0, key);
    leaf.values.splice(pos, 0, value);
    this.count += 1;
    if (leaf.keys.length <= this.leafMaxKeys) return;
    const splitAt = splitAtIndex(this.leafMaxKeys);
    const right = new LeafNode(
      this.allocId(),
      leaf.keys.splice(splitAt),
      leaf.values.splice(splitAt),
    );
    right.next = leaf.next;
    leaf.next = right.id;
    this.nodes.set(right.id, right);
    this.propagateSplit(leaf, right.keys[0], right, path);
  }

  get(key: string): number | undefined {
    const leaf = this.findLeaf(key);
    const pos = lowerBound(leaf.keys, key);
    if (pos < leaf.keys.length && leaf.keys[pos] === key) {
      return leaf.values[pos];
    }
    return undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    this.assertMutable();
    const pairs = this.sortedPairs();
    const pos = lowerBound(
      pairs.map((pair) => pair.key),
      key,
    );
    if (pos >= pairs.length || pairs[pos].key !== key) return false;
    pairs.splice(pos, 1);
    const rebuilt = rebalanceAfterDelete(
      pairs,
      this.leafMaxKeys,
      this.internalMaxKeys,
      this.nextId,
    );
    this.root = rebuilt.root;
    this.nodes.clear();
    for (const [id, node] of rebuilt.nodes) this.nodes.set(id, node);
    this.nextId = rebuilt.nextId;
    this.count -= 1;
    return true;
  }

  size(): number {
    return this.count;
  }

  height(): number {
    let height = 1;
    let node = this.root;
    while (!isLeafNode(node)) {
      height += 1;
      node = this.getNode(node.children[0]);
    }
    return height;
  }

  keys(): string[] {
    const out: string[] = [];
    let leaf = this.leftmostLeaf();
    while (leaf !== null) {
      out.push(...leaf.keys);
      leaf = leaf.next === null ? null : this.getLeaf(leaf.next);
    }
    return out;
  }

  range(lo: string, hi: string): { key: string; value: number }[] {
    const out: { key: string; value: number }[] = [];
    let leaf: LeafNode | null = this.findLeaf(lo);
    let pos = lowerBound(leaf.keys, lo);
    while (leaf !== null) {
      while (pos < leaf.keys.length) {
        const key = leaf.keys[pos];
        if (key > hi) return out;
        out.push({ key, value: leaf.values[pos] });
        pos += 1;
      }
      leaf = leaf.next === null ? null : this.getLeaf(leaf.next);
      pos = 0;
    }
    return out;
  }

  exportState(): BPlusTreeState {
    const leaves: BPlusTreeState["leaves"] = [];
    let leaf = this.leftmostLeaf();
    while (leaf !== null) {
      leaves.push({
        id: leaf.id,
        keys: [...leaf.keys],
        values: [...leaf.values],
        next: leaf.next,
      });
      leaf = leaf.next === null ? null : this.getLeaf(leaf.next);
    }
    const internals: BPlusTreeState["internals"] = [];
    const queue: InternalNode[] = isLeafNode(this.root) ? [] : [this.root];
    for (let i = 0; i < queue.length; i += 1) {
      const node = queue[i];
      internals.push({
        id: node.id,
        keys: [...node.keys],
        children: [...node.children],
      });
      for (const childId of node.children) {
        const child = this.getNode(childId);
        if (!isLeafNode(child)) queue.push(child);
      }
    }
    return {
      order: this.order,
      frozen: this.frozen,
      rootId: this.root.id,
      nextId: this.nextId,
      leaves,
      internals,
    };
  }

  static fromState(state: BPlusTreeState): BPlusTree {
    const tree = new BPlusTree(state.order);
    const nodes = new Map<number, AnyNode>();
    for (const leafState of state.leaves) {
      const leaf = new LeafNode(
        leafState.id,
        [...leafState.keys],
        [...leafState.values],
      );
      leaf.next = leafState.next;
      nodes.set(leaf.id, leaf);
    }
    for (const internalState of state.internals) {
      nodes.set(
        internalState.id,
        new InternalNode(
          internalState.id,
          [...internalState.keys],
          [...internalState.children],
        ),
      );
    }
    const root = nodes.get(state.rootId);
    if (!root) throw new BPlusError("fromState: missing root node");
    for (const node of nodes.values()) {
      if (isLeafNode(node)) {
        if (node.next !== null && !nodes.has(node.next)) {
          throw new BPlusError("fromState: dangling leaf link");
        }
      } else {
        for (const childId of node.children) {
          if (!nodes.has(childId)) {
            throw new BPlusError("fromState: dangling child");
          }
        }
      }
    }
    tree.nodes.clear();
    for (const [id, node] of nodes) tree.nodes.set(id, node);
    tree.root = root;
    tree.nextId = state.nextId;
    tree.frozen = state.frozen;
    tree.count = state.leaves.reduce((sum, leaf) => sum + leaf.keys.length, 0);
    return tree;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): BPlusStats {
    let leafCount = 0;
    for (const node of this.nodes.values()) {
      if (isLeafNode(node)) leafCount += 1;
    }
    return {
      order: this.order,
      frozen: this.frozen,
      size: this.count,
      height: this.height(),
      leafCount,
    };
  }

  private allocId(): number {
    const id = allocateId(this.nextId);
    this.nextId += 1;
    return id;
  }

  private assertMutable(): void {
    if (this.frozen) throw new BPlusError("BPlusTree is frozen");
  }

  private getNode(id: number): AnyNode {
    const node = this.nodes.get(id);
    if (!node) throw new BPlusError(`missing node ${id}`);
    return node;
  }

  private getLeaf(id: number): LeafNode {
    const node = this.getNode(id);
    if (!isLeafNode(node)) throw new BPlusError(`node ${id} is not a leaf`);
    return node;
  }

  private findLeaf(key: string): LeafNode {
    let node = this.root;
    while (!isLeafNode(node)) {
      node = this.getNode(node.children[childIndex(node.keys, key)]);
    }
    return node;
  }

  private leftmostLeaf(): LeafNode | null {
    let node = this.root;
    while (!isLeafNode(node)) {
      node = this.getNode(node.children[0]);
    }
    return node;
  }

  private sortedPairs(): { key: string; value: number }[] {
    const pairs: { key: string; value: number }[] = [];
    let leaf = this.leftmostLeaf();
    while (leaf !== null) {
      for (let i = 0; i < leaf.keys.length; i += 1) {
        pairs.push({ key: leaf.keys[i], value: leaf.values[i] });
      }
      leaf = leaf.next === null ? null : this.getLeaf(leaf.next);
    }
    return pairs;
  }

  private propagateSplit(
    left: AnyNode,
    separator: string,
    right: AnyNode,
    path: InternalNode[],
  ): void {
    const parent = path.pop();
    if (!parent) {
      const root = new InternalNode(this.allocId(), [separator], [
        left.id,
        right.id,
      ]);
      this.nodes.set(root.id, root);
      this.root = root;
      return;
    }
    const pos = childIndex(parent.keys, separator);
    parent.keys.splice(pos, 0, separator);
    parent.children.splice(pos + 1, 0, right.id);
    if (parent.keys.length <= this.internalMaxKeys) return;
    const splitAt = splitAtIndex(this.internalMaxKeys);
    const promoted = parent.keys[splitAt];
    const rightKeys = parent.keys.splice(splitAt + 1);
    const rightChildren = parent.children.splice(splitAt + 1);
    parent.keys.pop();
    const rightNode = new InternalNode(this.allocId(), rightKeys, rightChildren);
    this.nodes.set(rightNode.id, rightNode);
    this.propagateSplit(parent, promoted, rightNode, path);
  }
}
