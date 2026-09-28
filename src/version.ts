export type VersionNode = {
  id: number;
  key: string;
  value: string;
  refs: number;
};

/** Starter stub. */
export class VersionPool {
  alloc(_key: string, _value: string): VersionNode {
    throw new Error("version alloc not implemented");
  }

  retain(_node: VersionNode): void {
    throw new Error("retain not implemented");
  }

  release(_node: VersionNode): void {
    throw new Error("release not implemented");
  }

  liveCount(): number {
    return 0;
  }
}
