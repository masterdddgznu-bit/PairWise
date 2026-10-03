export class VNodeTable {
  constructor(_vnodeCount: number, _owners: string[]) {}
  ownerOf(_vnode: number): string {
    return "";
  }
  epochOf(_vnode: number): number {
    return 0;
  }
  setOwner(_vnode: number, _ownerId: string): void {}
  bumpEpoch(_vnode: number): number {
    return 0;
  }
}
