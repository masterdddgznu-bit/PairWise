export class AvlError extends Error {
  constructor(message = "Avl error") {
    super(message);
    this.name = "AvlError";
  }
}
