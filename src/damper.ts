export class DamperBank {
  private readonly sealed = new Set<string>();

  register(id: string): void {
    this.sealed.add(id);
  }

  forget(id: string): void {
    this.sealed.delete(id);
  }

  seal(id: string): void {
    this.sealed.add(id);
  }

  vent(id: string): void {
    this.sealed.delete(id);
  }

  isSealed(id: string): boolean {
    return this.sealed.has(id);
  }
}
