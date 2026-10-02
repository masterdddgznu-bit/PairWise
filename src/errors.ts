export class TxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxError";
  }
}
