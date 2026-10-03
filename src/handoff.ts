import type { HandoffView } from "./types.js";

export class HandoffBook {
  propose(
    _vnode: number,
    _from: string,
    _to: string,
    _deadline: number | null,
  ): string {
    return "";
  }
  prepare(_moveId: string): void {}
  commit(_moveId: string): {
    vnode: number;
    from: string;
    to: string;
  } {
    return { vnode: 0, from: "", to: "" };
  }
  abort(_moveId: string): { vnode: number } {
    return { vnode: 0 };
  }
  view(_vnode: number): HandoffView | undefined {
    return undefined;
  }
  get(_moveId: string):
    | { vnode: number; from: string; to: string; phase: string; deadline: number | null }
    | undefined {
    return undefined;
  }
  expired(_now: number): string[] {
    return [];
  }
  activeVNode(_vnode: number): boolean {
    return false;
  }
}
