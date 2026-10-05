export class QuarantineSet {
  private readonly flagged = new Set<string>();

  add(id: string): void {
    this.flagged.add(id);
  }

  remove(id: string): boolean {
    return this.flagged.delete(id);
  }

  has(id: string): boolean {
    return this.flagged.has(id);
  }
}
