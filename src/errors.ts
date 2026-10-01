export class RendezvousError extends Error {
  constructor(message = "Rendezvous error") {
    super(message);
    this.name = "RendezvousError";
  }
}
