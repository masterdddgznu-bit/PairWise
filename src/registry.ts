import { deepClone } from "./clone";
import { fail } from "./errors";

export interface VersionInfo {
  subject: string;
  version: number;
  schema: unknown;
  compatibleWith: number[];
  retired: boolean;
}

interface VersionRecord {
  version: number;
  schema: unknown;
  compatibleWith: number[];
  retired: boolean;
}

interface SubjectRecord {
  name: string;
  versions: Map<number, VersionRecord>;
  current: number;
}

export class Registry {
  private subjects = new Map<string, SubjectRecord>();

  constructor(private readonly maxSubjects?: number) {}

  hasSubject(name: string): boolean {
    return this.subjects.has(name);
  }

  subjectNames(): string[] {
    return [...this.subjects.keys()];
  }

  registerSubject(name: string, schema: unknown): void {
    if (this.subjects.has(name)) {
      fail("SUBJECT_EXISTS", `subject "${name}" already registered`);
    }
    if (
      this.maxSubjects !== undefined &&
      this.subjects.size >= this.maxSubjects
    ) {
      fail("SUBJECT_CAPACITY", "subject capacity reached");
    }
    const versions = new Map<number, VersionRecord>();
    versions.set(1, {
      version: 1,
      schema: deepClone(schema),
      compatibleWith: [],
      retired: false,
    });
    this.subjects.set(name, { name, versions, current: 1 });
  }

  addVersion(
    name: string,
    schema: unknown,
    compatibleWith: unknown,
    maxVersions?: number,
  ): number {
    const subject = this.requireSubject(name);
    if (!Array.isArray(compatibleWith)) {
      fail("INVALID_EDGES", "compatibleWith must be an array of versions");
    }
    const edges: number[] = [];
    const seen = new Set<number>();
    for (const edge of compatibleWith) {
      if (typeof edge !== "number" || !Number.isInteger(edge) || edge < 1) {
        fail("INVALID_EDGES", "compatibleWith entries must be positive integers");
      }
      if (seen.has(edge)) {
        continue;
      }
      seen.add(edge);
      const predecessor = subject.versions.get(edge);
      if (predecessor === undefined) {
        fail("VERSION_UNKNOWN", `version ${edge} does not exist on "${name}"`);
      }
      if (predecessor.retired) {
        fail("VERSION_RETIRED", `version ${edge} on "${name}" is retired`);
      }
      edges.push(edge);
    }
    if (maxVersions !== undefined && subject.versions.size >= maxVersions) {
      fail("VERSION_CAPACITY", "version capacity reached");
    }
    const version = subject.versions.size + 1;
    subject.versions.set(version, {
      version,
      schema: deepClone(schema),
      compatibleWith: edges,
      retired: false,
    });
    return version;
  }

  currentVersion(name: string): number {
    return this.requireSubject(name).current;
  }

  setCurrent(name: string, version: number): void {
    this.requireSubject(name).current = version;
  }

  hasVersion(name: string, version: number): boolean {
    const subject = this.subjects.get(name);
    return subject !== undefined && subject.versions.has(version);
  }

  isRetired(name: string, version: number): boolean {
    return this.requireVersion(name, version).retired;
  }

  retire(name: string, version: number): void {
    this.requireVersion(name, version).retired = true;
  }

  versions(name: string): VersionInfo[] {
    const subject = this.requireSubject(name);
    const infos: VersionInfo[] = [];
    for (const record of subject.versions.values()) {
      infos.push({
        subject: name,
        version: record.version,
        schema: deepClone(record.schema),
        compatibleWith: [...record.compatibleWith],
        retired: record.retired,
      });
    }
    return infos;
  }

  versionCount(): number {
    let total = 0;
    for (const subject of this.subjects.values()) {
      total += subject.versions.size;
    }
    return total;
  }

  reachable(name: string, from: number, to: number): boolean {
    const subject = this.requireSubject(name);
    if (!subject.versions.has(from) || !subject.versions.has(to)) {
      return false;
    }
    const visited = new Set<number>([to]);
    const stack = [to];
    while (stack.length > 0) {
      const node = stack.pop() as number;
      if (node === from) {
        return true;
      }
      const record = subject.versions.get(node);
      if (record === undefined) {
        continue;
      }
      for (const edge of record.compatibleWith) {
        if (!visited.has(edge)) {
          visited.add(edge);
          stack.push(edge);
        }
      }
    }
    return false;
  }

  private requireSubject(name: string): SubjectRecord {
    const subject = this.subjects.get(name);
    if (subject === undefined) {
      fail("SUBJECT_UNKNOWN", `subject "${name}" is not registered`);
    }
    return subject;
  }

  private requireVersion(name: string, version: number): VersionRecord {
    const subject = this.requireSubject(name);
    const record = subject.versions.get(version);
    if (record === undefined) {
      fail("VERSION_UNKNOWN", `version ${version} does not exist on "${name}"`);
    }
    return record;
  }
}
