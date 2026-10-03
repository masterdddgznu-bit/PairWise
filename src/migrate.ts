import { FeatureNotReadyError } from "./errors.js";
export class MigrateTable {
  begin(_key: string, _to: string, _from: string): void { throw new FeatureNotReadyError("beginMove"); }
  commit(_key: string): string { throw new FeatureNotReadyError("commitMove"); }
  abort(_key: string): void { throw new FeatureNotReadyError("abortMove"); }
  movingTo(_key: string): string | undefined { return undefined; }
  movingFrom(_key: string): string | undefined { return undefined; }
  stickyOwner(_key: string): string | undefined { return undefined; }
  dropStickyForNode(_nodeId: string): void {}
  exportState(): unknown { return { moves: {}, sticky: {} }; }
  importState(_raw: unknown): void {}
}
