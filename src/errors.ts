export class TreapError extends Error {
  constructor(message = "Treap error") {
    super(message);
    this.name = "TreapError";
  }
}
