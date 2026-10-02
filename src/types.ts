export type RbColor = "red" | "black";

export type RbNodeState = {
  id: number;
  key: string;
  value: number;
  color: RbColor;
  leftId: number | null;
  rightId: number | null;
  parentId: number | null;
};

export type RbTreeState = {
  frozen: boolean;
  rootId: number | null;
  nextId: number;
  nodes: RbNodeState[];
};

export type RbStats = {
  frozen: boolean;
  size: number;
  height: number;
  blackHeight: number;
  nodeCount: number;
  redCount: number;
  blackCount: number;
};

/** Mutable root handle for rotate / fixup helpers. */
export type RbHandle = {
  root: import("./node.js").RbNode | null;
};
