import type { TreapState, TreapStats } from "./types.js";
import { TreapError } from "./errors.js";
import { TreapNode } from "./node.js";
import { LcgRng } from "./rng.js";
import { rotateLeft, rotateRight } from "./rotate.js";

function mergeNodes(
  left: TreapNode | null,
  right: TreapNode | null,
): TreapNode | null {
  if (left === null) return right;
  if (right === null) return left;
  if (left.priority >= right.priority) {
    left.right = mergeNodes(left.right, right);
    return left;
  }
  right.left = mergeNodes(left, right.left);
  return right;
}

function splitNodes(
  node: TreapNode | null,
  key: string,
): [TreapNode | null, TreapNode | null] {
  if (node === null) return [null, null];
  if (key <= node.key) {
    const [left, right] = splitNodes(node.left, key);
    node.left = right;
    return [left, node];
  }
  const [left, right] = splitNodes(node.right, key);
  node.right = left;
  return [node, right];
}

function countNodes(node: TreapNode | null): number {
  if (node === null) return 0;
  return 1 + countNodes(node.left) + countNodes(node.right);
}

/** Deterministic treap ordered map: BST by key, max-heap by priority. */
export class Treap {
  private root: TreapNode | null = null;
  private count = 0;
  private frozen = false;
  private readonly seed: number;
  private rng: LcgRng;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = new LcgRng(seed);
  }

  set(key: string, value: number): void {
    this.assertMutable();
    const existing = this.findNode(key);
    if (existing !== null) {
      existing.value = value;
      return;
    }
    const node = new TreapNode(key, value, this.rng.next());
    this.root = Treap.insertNode(this.root, node);
    this.count += 1;
  }

  get(key: string): number | undefined {
    return this.findNode(key)?.value;
  }

  has(key: string): boolean {
    return this.findNode(key) !== null;
  }

  delete(key: string): boolean {
    this.assertMutable();
    if (this.findNode(key) === null) return false;
    this.root = Treap.deleteNode(this.root, key);
    this.count -= 1;
    return true;
  }

  size(): number {
    return this.count;
  }

  keys(): string[] {
    return this.toArray().map((entry) => entry.key);
  }

  toArray(): { key: string; value: number; priority: number }[] {
    const out: { key: string; value: number; priority: number }[] = [];
    const walk = (node: TreapNode | null): void => {
      if (node === null) return;
      walk(node.left);
      out.push({ key: node.key, value: node.value, priority: node.priority });
      walk(node.right);
    };
    walk(this.root);
    return out;
  }

  split(key: string): { left: Treap; right: Treap } {
    const [leftRoot, rightRoot] = splitNodes(this.root, key);
    const left = this.derive(leftRoot);
    const right = this.derive(rightRoot);
    this.root = null;
    this.count = 0;
    return { left, right };
  }

  static merge(left: Treap, right: Treap): Treap {
    const leftMax = left.maxKey();
    const rightMin = right.minKey();
    if (leftMax !== null && rightMin !== null && leftMax >= rightMin) {
      throw new TreapError("merge requires all left keys < all right keys");
    }
    const merged = left.derive(mergeNodes(left.root, right.root));
    merged.count = left.count + right.count;
    return merged;
  }

  exportState(): TreapState {
    return {
      seed: this.seed,
      rngState: this.rng.getState(),
      entries: this.toArray(),
    };
  }

  static fromState(state: TreapState): Treap {
    const treap = new Treap(state.seed);
    treap.rng = LcgRng.fromState(state.rngState);
    for (const entry of state.entries) {
      const node = new TreapNode(entry.key, entry.value, entry.priority);
      treap.root = Treap.insertNode(treap.root, node);
    }
    treap.count = state.entries.length;
    return treap;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): TreapStats {
    return { seed: this.seed, frozen: this.frozen, size: this.count };
  }

  private assertMutable(): void {
    if (this.frozen) throw new TreapError("treap is frozen");
  }

  private findNode(key: string): TreapNode | null {
    let node = this.root;
    while (node !== null) {
      if (key < node.key) node = node.left;
      else if (key > node.key) node = node.right;
      else return node;
    }
    return null;
  }

  private derive(root: TreapNode | null): Treap {
    const treap = new Treap(this.seed);
    treap.rng = LcgRng.fromState(this.rng.getState());
    treap.root = root;
    treap.count = countNodes(root);
    return treap;
  }

  private minKey(): string | null {
    let node = this.root;
    if (node === null) return null;
    while (node.left !== null) node = node.left;
    return node.key;
  }

  private maxKey(): string | null {
    let node = this.root;
    if (node === null) return null;
    while (node.right !== null) node = node.right;
    return node.key;
  }

  private static insertNode(root: TreapNode | null, node: TreapNode): TreapNode {
    if (root === null) return node;
    if (node.key < root.key) {
      root.left = Treap.insertNode(root.left, node);
      if (root.left !== null && root.left.priority > root.priority) {
        return rotateRight(root);
      }
      return root;
    }
    root.right = Treap.insertNode(root.right, node);
    if (root.right !== null && root.right.priority > root.priority) {
      return rotateLeft(root);
    }
    return root;
  }

  private static deleteNode(
    root: TreapNode | null,
    key: string,
  ): TreapNode | null {
    if (root === null) return null;
    if (key < root.key) {
      root.left = Treap.deleteNode(root.left, key);
      return root;
    }
    if (key > root.key) {
      root.right = Treap.deleteNode(root.right, key);
      return root;
    }
    return mergeNodes(root.left, root.right);
  }
}
