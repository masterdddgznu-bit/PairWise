export class VirtualClock {
  private t = 0;
  private seq = 0;
  now(): number { return this.t; }
  advance(ms: number): void { this.t += ms; }
  nextMsgId(): string {
    this.seq += 1;
    return `m${this.seq}`;
  }
}
