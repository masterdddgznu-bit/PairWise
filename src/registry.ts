import { deepClone } from "./clone";
import { fail } from "./errors";

export interface VersionInfo {
  version: number;
  schema: unknown;
  compatibleWith: number[];
  retired: boolean;
}

interface VersionState {
  version: number;
  schema: unknown;
  compatibleWith: number[];
  retired: boolean;
}

interface SubjectState {
  name: string;
  versions: Map<number, VersionState>;
  current: number;
  committedTargets: Set<number>;
}

export class Registry {
  private subjects = new Map<string, SubjectState>();

  constructor(
    private readonly maxSubjects?: number,
    private readonly maxVersions?: number,
  ) {}

  get subjectCount(): number {
    return this.subjects.size;
  }

  get versionCount(): number {
    let total = 0;
    for (const subject of this.subjects.values()) {
      total += subject.versions.size;
    }
    return total;
  }

  get retiredCount(): number {
    let total = 0;
    for (const subject of this.subjects.values()) {
      for (const version of subject.versions.values()) {
        if (version.retired) total += 1;
      }
    }
    return total;
  }

  hasSubject(name: string): boolean {
    return this.subjects.has(name);
  }

  subjectNames(): string[] {
    return [...this.subjects.keys()];
  }

  private subject(name: string): SubjectState {
    const subject = this.subjects.get(name);
    if (!subject) fail("NO_SUCH_SUBJECT", `unknown subject: ${name}`);
    return subject;
  }

  registerSubject(name: string, schema: unknown): void {
    if (this.subjects.has(name)) {
      fail("SUBJECT_EXISTS", `subject already registered: ${name}`);
    }
    if (this.maxSubjects !== undefined && this.subjects.size >= this.maxSubjects) {
      fail("SUBJECT_CAPACITY", `subject capacity ${this.maxSubjects} reached`);
    }
    const initial: VersionState = {
      version: 1,
      schema: deepClone(schema),
      compatibleWith: [],
      retired: false,
    };
    this.subjects.set(name, {
      name,
      versions: new Map([[1, initial]]),
      current: 1,
      committedTargets: new Set(),
    });
  }

  addVersion(name: string, schema: unknown, compatibleWith: number[]): number {
    const subject = this.subject(name);
    if (this.maxVersions !== undefined && subject.versions.size >= this.maxVersions) {
      fail("VERSION_CAPACITY", `version capacity ${this.maxVersions} reached for ${name}`);
    }
    const normalized = [...new Set(compatibleWith)].sort((a, b) => a - b);
    for (const predecessor of normalized) {
      const record = subject.versions.get(predecessor);
      if (!record) {
        fail("NO_SUCH_VERSION", `subject ${name} has no version ${predecessor}`);
      }
      if (record.retired) {
        fail("PREDECESSOR_RETIRED", `version ${predecessor} of ${name} is retired`);
      }
    }
    const next = Math.max(...subject.versions.keys()) + 1;
    subject.versions.set(next, {
      version: next,
      schema: deepClone(schema),
      compatibleWith: normalized,
      retired: false,
    });
    return next;
  }

  currentVersion(name: string): number {
    return this.subject(name).current;
  }

  hasVersion(name: string, version: number): boolean {
    const subject = this.subjects.get(name);
    return subject !== undefined && subject.versions.has(version);
  }

  isRetired(name: string, version: number): boolean {
    return this.subject(name).versions.get(version)?.retired ?? false;
  }

  versions(name: string): VersionInfo[] {
    const subject = this.subject(name);
    return [...subject.versions.values()]
      .sort((a, b) => a.version - b.version)
      .map((record) => deepClone(record) as VersionInfo);
  }

  private ancestors(subject: SubjectState, version: number): Set<number> {
    const seen = new Set<number>();
    const stack = [...(subject.versions.get(version)?.compatibleWith ?? [])];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      if (seen.has(current)) continue;
      seen.add(current);
      const record = subject.versions.get(current);
      if (record) stack.push(...record.compatibleWith);
    }
    return seen;
  }

  reachable(name: string, from: number, to: number): boolean {
    const subject = this.subject(name);
    if (!subject.versions.has(from) || !subject.versions.has(to)) return false;
    if (from === to) return true;
    return this.ancestors(subject, to).has(from);
  }

  dependsOn(name: string, target: number, version: number): boolean {
    const subject = this.subject(name);
    if (target === version) return true;
    return this.ancestors(subject, target).has(version);
  }

  hasCommittedSuccessor(name: string, version: number): boolean {
    const subject = this.subject(name);
    for (const target of subject.committedTargets) {
      if (target !== version && this.ancestors(subject, target).has(version)) {
        return true;
      }
    }
    return false;
  }

  advanceCurrent(name: string, version: number): void {
    this.subject(name).current = version;
  }

  noteCommitted(name: string, target: number): void {
    this.subject(name).committedTargets.add(target);
  }

  retire(name: string, version: number): void {
    const record = this.subject(name).versions.get(version);
    if (!record) fail("NO_SUCH_VERSION", `subject ${name} has no version ${version}`);
    record.retired = true;
  }

  restoreVersion(name: string, version: number, schema: unknown, compatibleWith: number[]): void {
    const subject = this.subject(name);
    subject.versions.set(version, {
      version,
      schema: deepClone(schema),
      compatibleWith: [...compatibleWith],
      retired: false,
    });
  }
}
