import type { Message } from "./types.js";
export class SProc {
  readonly id: number;
  inbox: Message[] = [];
  values: Set<string> = new Set();
  decided = false;
  decision: string | null = null;
  constructor(id: number) { this.id = id; }
}
