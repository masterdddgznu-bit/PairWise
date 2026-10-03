export class TaskMeshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TaskMeshError {}

export class DuplicateTaskError extends TaskMeshError {}

export class UnknownTaskError extends TaskMeshError {}

export class InvalidTaskError extends TaskMeshError {}

export class LeaseError extends TaskMeshError {}
