export class Token {
  ln: number[];
  queue: number[];
  constructor(n: number) {
    this.ln = Array(n).fill(0);
    this.queue = [];
  }
  clone(): Token {
    const t = new Token(this.ln.length);
    t.ln = [...this.ln];
    t.queue = [...this.queue];
    return t;
  }
}
