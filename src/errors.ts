export class CompactedError extends Error {
  constructor(message = "Sequence has been compacted") {
    super(message);
    this.name = "CompactedError";
  }
}
