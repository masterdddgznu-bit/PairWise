/** Committed offsets per group/topic/partition — stub always zero. */
export class OffsetManager {
  getCommitted(_groupId: string, _topic: string, _partition: number): number {
    return 0;
  }

  setCommitted(_groupId: string, _topic: string, _partition: number, _offset: number): void {
    /* no-op */
  }
}
