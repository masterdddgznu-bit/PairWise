import type { Atom, Dot } from "./types.js";
import { dotKey } from "./dot.js";

export function cloneAtom(atom: Atom): Atom {
  return {
    id: { ...atom.id },
    value: atom.value,
    leftOrigin: atom.leftOrigin === null ? null : { ...atom.leftOrigin },
  };
}

export class AtomStore {
  private readonly atoms = new Map<string, Atom>();

  insertAfter(after: Dot | null, ch: string, id: Dot): void {
    this.atoms.set(dotKey(id), {
      id: { ...id },
      value: ch,
      leftOrigin: after === null ? null : { ...after },
    });
  }

  tombstone(id: Dot): boolean {
    const atom = this.atoms.get(dotKey(id));
    if (atom === undefined || atom.value === null) return false;
    atom.value = null;
    return true;
  }

  get(id: Dot): Atom | undefined {
    const atom = this.atoms.get(dotKey(id));
    return atom === undefined ? undefined : cloneAtom(atom);
  }

  all(): Atom[] {
    return [...this.atoms.values()];
  }

  mergeAtom(atom: Atom): void {
    const key = dotKey(atom.id);
    const existing = this.atoms.get(key);
    if (existing === undefined) {
      this.atoms.set(key, cloneAtom(atom));
      return;
    }
    if (atom.value === null) existing.value = null;
  }

  mergeFrom(other: AtomStore): void {
    for (const atom of other.all()) this.mergeAtom(atom);
  }

  gcTombstones(pred: (id: Dot) => boolean): number {
    const toRemove = new Set<string>();
    for (const atom of this.atoms.values()) {
      if (atom.value === null && pred(atom.id)) toRemove.add(dotKey(atom.id));
    }
    if (toRemove.size === 0) return 0;
    const resolveOrigin = (origin: Dot | null): Dot | null => {
      let cur = origin;
      while (cur !== null && toRemove.has(dotKey(cur))) {
        const parent = this.atoms.get(dotKey(cur));
        cur = parent === undefined ? null : parent.leftOrigin;
      }
      return cur;
    };
    for (const atom of this.atoms.values()) {
      if (toRemove.has(dotKey(atom.id))) continue;
      if (atom.leftOrigin !== null && toRemove.has(dotKey(atom.leftOrigin))) {
        atom.leftOrigin = resolveOrigin(atom.leftOrigin);
      }
    }
    for (const key of toRemove) this.atoms.delete(key);
    return toRemove.size;
  }
}
