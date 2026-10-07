export class PlugGate {
  private readonly plugged = new Set<string>();

  plug(id: string): void {
    this.plugged.add(id);
  }

  unplug(id: string): void {
    this.plugged.delete(id);
  }

  isPlugged(id: string): boolean {
    return this.plugged.has(id);
  }

  clear(id: string): void {
    this.plugged.delete(id);
  }
}
