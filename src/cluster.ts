import { VirtualClock } from "./clock.js";
import type { GetResult, Hint, PutResult } from "./types.js";

/**
 * Dynamo-style sloppy quorum cluster with hinted handoff (feature incomplete).
 */
export class HintCluster {
  constructor(
    _clock: VirtualClock,
    _nodeIds: string[],
    _n: number,
    _r: number,
    _w: number,
  ) {
    throw new Error("HintCluster not implemented");
  }

  put(_key: string, _value: string, _available: string[]): PutResult {
    throw new Error("put not implemented");
  }

  get(_key: string, _available: string[]): GetResult {
    throw new Error("get not implemented");
  }

  deliverHints(_holder: string, _target: string): number {
    throw new Error("deliverHints not implemented");
  }

  preferenceList(_key: string): string[] {
    throw new Error("preferenceList not implemented");
  }

  hintsFor(_holder: string): Hint[] {
    throw new Error("hintsFor not implemented");
  }

  nodeGet(_nodeId: string, _key: string): string | undefined {
    throw new Error("nodeGet not implemented");
  }
}
