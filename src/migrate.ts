import { InvalidStateError } from "./errors.js";

type Move = { from: string; to: string };

export class MigrateTable {
  private readonly moves = new Map<string, Move>();
  private readonly sticky = new Map<string, string>();

  begin(key: string, to: string, from: string): void {
    if (this.moves.has(key)) throw new InvalidStateError(`move already in progress for ${key}`);
    this.moves.set(key, { from, to });
  }
  commit(key: string): string {
    const m = this.moves.get(key);
    if (!m) throw new InvalidStateError(`no move in progress for ${key}`);
    this.moves.delete(key);
    this.sticky.set(key, m.to);
    return m.to;
  }
  abort(key: string): void {
    if (!this.moves.has(key)) throw new InvalidStateError(`no move in progress for ${key}`);
    this.moves.delete(key);
  }
  movingTo(key: string): string | undefined { return this.moves.get(key)?.to; }
  movingFrom(key: string): string | undefined { return this.moves.get(key)?.from; }
  stickyOwner(key: string): string | undefined { return this.sticky.get(key); }
  dropStickyForNode(nodeId: string): void {
    for (const [k, v] of this.sticky) {
      if (v === nodeId) this.sticky.delete(k);
    }
    for (const [k, m] of this.moves) {
      if (m.to === nodeId || m.from === nodeId) this.moves.delete(k);
    }
  }
  exportState(): unknown {
    return {
      moves: Object.fromEntries([...this.moves].map(([k, m]) => [k, { ...m }])),
      sticky: Object.fromEntries(this.sticky),
    };
  }
  importState(raw: unknown): void {
    this.moves.clear();
    this.sticky.clear();
    const s = raw as { moves?: Record<string, Move>; sticky?: Record<string, string> } | null | undefined;
    if (!s) return;
    for (const [k, m] of Object.entries(s.moves ?? {})) {
      this.moves.set(k, { from: m.from, to: m.to });
    }
    for (const [k, v] of Object.entries(s.sticky ?? {})) {
      this.sticky.set(k, v);
    }
  }
}
