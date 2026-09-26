import type { CfgStack } from "./stack.js";

export class SnapshotStore {
  snapshot(_stack: CfgStack): string {
    throw new Error("snapshot not implemented");
  }

  restore(_stack: CfgStack, _snapId: string): void {
    throw new Error("restore not implemented");
  }
}
