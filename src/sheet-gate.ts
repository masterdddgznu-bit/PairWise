export class SheetGate {
  private readonly sheetedIds = new Set<string>();

  sheet(id: string): void {
    this.sheetedIds.add(id);
  }

  unsheet(id: string): void {
    this.sheetedIds.delete(id);
  }

  isSheeted(id: string): boolean {
    return this.sheetedIds.has(id);
  }

  forget(id: string): void {
    this.sheetedIds.delete(id);
  }
}
