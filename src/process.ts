import type { Message } from "./types.js";

export class OProc {
  readonly id: number;
  inbox: Message[] = [];
  collected = new Map<string, string>();
  decided = false;
  decision: string | null = null;
  constructor(id: number) { this.id = id; }
}
