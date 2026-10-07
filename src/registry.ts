export interface Forme {
  id: string;
  payload: unknown;
  pressAt: number;
  liftAt: number;
  impressions: number;
  masked: boolean;
  seq: number;
}

export interface FormeView {
  id: string;
  payload: unknown;
  pressAt: number;
  liftAt: number;
  impressions: number;
}

export function viewOf(forme: Forme): FormeView {
  return {
    id: forme.id,
    payload: forme.payload,
    pressAt: forme.pressAt,
    liftAt: forme.liftAt,
    impressions: forme.impressions,
  };
}

export function compareFormes(a: Forme, b: Forme): number {
  if (a.liftAt !== b.liftAt) return a.liftAt - b.liftAt;
  if (a.impressions !== b.impressions) return b.impressions - a.impressions;
  return a.seq - b.seq;
}

export class FormeRegistry {
  #formes = new Map<string, Forme>();
  #nextSeq = 0;

  get(id: string): Forme | undefined {
    return this.#formes.get(id);
  }

  size(): number {
    return this.#formes.size;
  }

  ids(): string[] {
    return [...this.#formes.keys()];
  }

  entries(): Forme[] {
    return [...this.#formes.values()];
  }

  add(
    id: string,
    payload: unknown,
    pressAt: number,
    liftAt: number,
    impressions: number,
  ): Forme {
    const forme: Forme = {
      id,
      payload,
      pressAt,
      liftAt,
      impressions,
      masked: false,
      seq: this.#nextSeq++,
    };
    this.#formes.set(id, forme);
    return forme;
  }

  overwrite(
    forme: Forme,
    payload: unknown,
    pressAt: number,
    liftAt: number,
    impressions: number,
  ): void {
    forme.payload = payload;
    forme.pressAt = pressAt;
    forme.liftAt = liftAt;
    forme.impressions = impressions;
    forme.masked = false;
  }

  remove(id: string): boolean {
    return this.#formes.delete(id);
  }

  isLive(forme: Forme, now: number): boolean {
    return forme.pressAt < now && now <= forme.liftAt;
  }

  isSpent(forme: Forme, now: number): boolean {
    return now > forme.liftAt;
  }

  candidates(now: number): Forme[] {
    return this.entries()
      .filter(
        (forme) =>
          !forme.masked && forme.impressions >= 1 && this.isLive(forme, now),
      )
      .sort(compareFormes);
  }

  spentIds(now: number): string[] {
    return this.entries()
      .filter((forme) => !forme.masked && this.isSpent(forme, now))
      .map((forme) => forme.id);
  }
}
