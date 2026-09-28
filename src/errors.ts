export class VecBufError extends Error {
  constructor(message = "VecBuf error") {
    super(message);
    this.name = "VecBufError";
  }
}
