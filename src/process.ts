import type { Message } from "./types.js";
export class BProc {
  readonly id: number;
  inbox: Message[] = [];
  echoed = false;
  readied = false;
  delivered: string | null = null;
  echoFrom = new Map<string, Set<number>>();
  readyFrom = new Map<string, Set<number>>();
  constructor(id: number) { this.id = id; }
}
