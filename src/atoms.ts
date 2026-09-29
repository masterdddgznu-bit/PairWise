import type { Atom, Dot } from "./types.js";
import { dotKey } from "./dot.js";

function copyAtom(atom: Atom): Atom {
  return {
    id: { ...atom.id },
    value: atom.value,
    leftOrigin: atom.leftOrigin ? { ...atom.leftOrigin } : null,
  };
}

export class AtomStore {
  private readonly atoms = new Map<string, Atom>();

  insertAfter(after: Dot | null, ch: string, id: Dot): void {
    this.atoms.set(dotKey(id), {
      id: { ...id },
      value: ch,
      leftOrigin: after ? { ...after } : null,
    });
  }

  tombstone(id: Dot): boolean {
    const atom = this.atoms.get(dotKey(id));
    if (!atom || atom.value === null) return false;
    atom.value = null;
    return true;
  }

  get(id: Dot): Atom | undefined {
    const atom = this.atoms.get(dotKey(id));
    return atom ? copyAtom(atom) : undefined;
  }

  all(): Atom[] {
    return [...this.atoms.values()].map(copyAtom);
  }

  mergeFrom(other: AtomStore): void {
    this.mergeAtoms(other.all());
  }

  mergeAtoms(atoms: Atom[]): void {
    for (const atom of atoms) {
      const key = dotKey(atom.id);
      const existing = this.atoms.get(key);
      if (!existing) {
        this.atoms.set(key, copyAtom(atom));
      } else if (atom.value === null && existing.value !== null) {
        existing.value = null;
      }
    }
  }

  gcTombstones(pred: (id: Dot) => boolean): number {
    let removed = 0;
    for (const [key, atom] of this.atoms) {
      if (atom.value === null && pred(atom.id)) {
        this.atoms.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
