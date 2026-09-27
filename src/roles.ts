import { CycleError } from "./errors.js";

/** Role inheritance — starter stub. */
export class RoleGraph {
  private readonly parents = new Map<string, Set<string>>();

  addParent(_child: string, _parent: string): void {
    throw new Error("addRoleParent not implemented");
  }

  /** All roles including self, following parent links. */
  expand(role: string): string[] {
    return [role];
  }

  // silence
  reserved(): void {
    void CycleError;
  }
}
