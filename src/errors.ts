export class MerkleError extends Error {
  constructor(message = "Merkle error") {
    super(message);
    this.name = "MerkleError";
  }
}
