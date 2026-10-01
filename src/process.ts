import type { Message } from "./types.js";

export function pathKey(path: number[]): string {
  return path.join("|");
}

export class OProc {
  readonly id: number;
  inbox: Message[] = [];
  decided = false;
  decision: string | null = null;
  readonly collected = new Map<string, string>();
  constructor(id: number) { this.id = id; }

  record(path: number[], value: string): void {
    const key = pathKey(path);
    if (!this.collected.has(key)) this.collected.set(key, value);
  }

  lookup(path: number[]): string | undefined {
    return this.collected.get(pathKey(path));
  }

  clear(): void {
    this.inbox = [];
    this.decided = false;
    this.decision = null;
    this.collected.clear();
  }
}
