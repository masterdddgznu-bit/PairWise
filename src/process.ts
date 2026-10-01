import type { Message } from "./types.js";
export class DProc {
  readonly id: number;
  inbox: Message[] = [];
  round = 1;
  decided = false;
  decision: string | null = null;
  extracted = new Set<string>();
  constructor(id: number) { this.id = id; }
}
