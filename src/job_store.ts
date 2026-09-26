import type { JobRecord, JobStatus } from "./types.js";

/** In-memory job records (treated as durable across crash in the facade). */
export class JobStore {
  private jobs = new Map<string, JobRecord>();

  has(id: string): boolean {
    return this.jobs.has(id);
  }

  get(id: string): JobRecord | undefined {
    const j = this.jobs.get(id);
    return j ? { ...j, deps: [...j.deps] } : undefined;
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].map((j) => ({ ...j, deps: [...j.deps] }));
  }

  insert(job: JobRecord): void {
    this.jobs.set(job.id, {
      ...job,
      deps: [...job.deps],
    });
  }

  update(id: string, patch: Partial<JobRecord>): void {
    const cur = this.jobs.get(id);
    if (!cur) return;
    Object.assign(cur, patch);
    if (patch.deps) cur.deps = [...patch.deps];
  }

  setStatus(id: string, status: JobStatus): void {
    const cur = this.jobs.get(id);
    if (!cur) return;
    cur.status = status;
  }

  clear(): void {
    this.jobs.clear();
  }

  replaceAll(jobs: JobRecord[]): void {
    this.jobs.clear();
    for (const j of jobs) {
      this.insert(j);
    }
  }
}
