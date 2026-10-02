import { TreapError } from "./errors.js";
import { TreapNode } from "./node.js";
import { LcgRng } from "./rng.js";
import { rotateLeft, rotateRight } from "./rotate.js";
import type { TreapState, TreapStats } from "./types.js";

function insertNode(
  node: TreapNode | null,
  key: string,
  value: number,
  priority: number,
): { node: TreapNode; inserted: boolean } {
  if (node === null) {
    return { node: new TreapNode(key, value, priority), inserted: true };
  }
  if (key < node.key) {
    const result = insertNode(node.left, key, value, priority);
    node.left = result.node;
    if (result.inserted && node.left.priority > node.priority) {
      return { node: rotateRight(node), inserted: true };
    }
    return { node, inserted: result.inserted };
  }
  if (key > node.key) {
    const result = insertNode(node.right, key, value, priority);
    node.right = result.node;
    if (result.inserted && node.right.priority > node.priority) {
      return { node: rotateLeft(node), inserted: true };
    }
    return { node, inserted: result.inserted };
  }
  node.value = value;
  return { node, inserted: false };
}

function deleteNode(
  node: TreapNode | null,
  key: string,
): TreapNode | null {
  if (node === null) {
    return null;
  }
  if (key < node.key) {
    node.left = deleteNode(node.left, key);
    return node;
  }
  if (key > node.key) {
    node.right = deleteNode(node.right, key);
    return node;
  }
  if (node.left === null) {
    return node.right;
  }
  if (node.right === null) {
    return node.left;
  }
  if (node.left.priority >= node.right.priority) {
    const rotated = rotateRight(node);
    rotated.right = deleteNode(rotated.right, key);
    return rotated;
  }
  const rotated = rotateLeft(node);
  rotated.left = deleteNode(rotated.left, key);
  return rotated;
}

function splitNode(
  node: TreapNode | null,
  key: string,
): { left: TreapNode | null; right: TreapNode | null } {
  if (node === null) {
    return { left: null, right: null };
  }
  if (node.key < key) {
    const result = splitNode(node.right, key);
    node.right = result.left;
    return { left: node, right: result.right };
  }
  const result = splitNode(node.left, key);
  node.left = result.right;
  return { left: result.left, right: node };
}

function mergeNodes(
  left: TreapNode | null,
  right: TreapNode | null,
): TreapNode | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  if (left.priority >= right.priority) {
    left.right = mergeNodes(left.right, right);
    return left;
  }
  right.left = mergeNodes(left, right.left);
  return right;
}

function cloneNode(node: TreapNode | null): TreapNode | null {
  if (node === null) {
    return null;
  }
  const copy = new TreapNode(node.key, node.value, node.priority);
  copy.left = cloneNode(node.left);
  copy.right = cloneNode(node.right);
  return copy;
}

function countNodes(node: TreapNode | null): number {
  if (node === null) {
    return 0;
  }
  return 1 + countNodes(node.left) + countNodes(node.right);
}

function findNode(node: TreapNode | null, key: string): TreapNode | null {
  let current = node;
  while (current !== null) {
    if (key < current.key) {
      current = current.left;
    } else if (key > current.key) {
      current = current.right;
    } else {
      return current;
    }
  }
  return null;
}

/** Deterministic treap ordered map (BST by key, max-heap by priority). */
export class Treap {
  private readonly seed: number;
  private rng: LcgRng;
  private root: TreapNode | null = null;
  private count = 0;
  private frozen = false;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = new LcgRng(seed);
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new TreapError("Treap is frozen");
    }
  }

  set(key: string, value: number): void {
    this.assertMutable();
    const existing = findNode(this.root, key);
    const priority = existing === null ? this.rng.next() : existing.priority;
    const result = insertNode(this.root, key, value, priority);
    this.root = result.node;
    if (result.inserted) {
      this.count += 1;
    }
  }

  get(key: string): number | undefined {
    return findNode(this.root, key)?.value;
  }

  has(key: string): boolean {
    return findNode(this.root, key) !== null;
  }

  delete(key: string): boolean {
    this.assertMutable();
    if (findNode(this.root, key) === null) {
      return false;
    }
    this.root = deleteNode(this.root, key);
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
    const entries: { key: string; value: number; priority: number }[] = [];
    const stack: TreapNode[] = [];
    let current = this.root;
    while (current !== null || stack.length > 0) {
      while (current !== null) {
        stack.push(current);
        current = current.left;
      }
      const node = stack.pop()!;
      entries.push({
        key: node.key,
        value: node.value,
        priority: node.priority,
      });
      current = node.right;
    }
    return entries;
  }

  split(key: string): { left: Treap; right: Treap } {
    this.assertMutable();
    const rngState = this.rng.getState();
    const parts = splitNode(this.root, key);
    const left = Treap.adopt(this.seed, rngState, parts.left);
    const right = Treap.adopt(this.seed, rngState, parts.right);
    this.root = null;
    this.count = 0;
    return { left, right };
  }

  private static adopt(
    seed: number,
    rngState: number,
    root: TreapNode | null,
  ): Treap {
    const treap = new Treap(seed);
    treap.rng = LcgRng.fromState(rngState);
    treap.root = root;
    treap.count = countNodes(root);
    return treap;
  }

  static merge(left: Treap, right: Treap): Treap {
    if (left.seed !== right.seed) {
      throw new TreapError("Cannot merge treaps with different seeds");
    }
    const leftEntries = left.toArray();
    const rightEntries = right.toArray();
    if (
      leftEntries.length > 0 &&
      rightEntries.length > 0 &&
      leftEntries[leftEntries.length - 1]!.key >= rightEntries[0]!.key
    ) {
      throw new TreapError(
        "Cannot merge: left keys must all be less than right keys",
      );
    }
    const mergedRoot = mergeNodes(
      cloneNode(left.root),
      cloneNode(right.root),
    );
    return Treap.adopt(left.seed, left.rng.getState(), mergedRoot);
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
      const result = insertNode(
        treap.root,
        entry.key,
        entry.value,
        entry.priority,
      );
      treap.root = result.node;
      if (result.inserted) {
        treap.count += 1;
      }
    }
    return treap;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): TreapStats {
    return {
      seed: this.seed,
      frozen: this.frozen,
      size: this.count,
    };
  }
}
