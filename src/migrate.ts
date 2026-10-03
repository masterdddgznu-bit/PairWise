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
    const move = this.moves.get(key);
    if (!move) throw new InvalidStateError(`no move in progress for ${key}`);
    this.moves.delete(key);
    this.sticky.set(key, move.to);
    return move.to;
  }
  abort(key: string): void {
    this.moves.delete(key);
  }
  movingTo(key: string): string | undefined { return this.moves.get(key)?.to; }
  movingFrom(key: string): string | undefined { return this.moves.get(key)?.from; }
  stickyOwner(key: string): string | undefined { return this.sticky.get(key); }
  dropStickyForNode(nodeId: string): void {
    for (const [key, owner] of [...this.sticky]) {
      if (owner === nodeId) this.sticky.delete(key);
    }
    for (const [key, move] of [...this.moves]) {
      if (move.to === nodeId || move.from === nodeId) this.moves.delete(key);
    }
  }
  exportState(): unknown {
    return { moves: Object.fromEntries(this.moves), sticky: Object.fromEntries(this.sticky) };
  }
  importState(raw: unknown): void {
    const s = raw as { moves?: Record<string, Move>; sticky?: Record<string, string> };
    this.moves.clear();
    this.sticky.clear();
    for (const [key, move] of Object.entries(s.moves ?? {})) {
      this.moves.set(key, { from: move.from, to: move.to });
    }
    for (const [key, owner] of Object.entries(s.sticky ?? {})) {
      this.sticky.set(key, owner);
    }
  }
}
