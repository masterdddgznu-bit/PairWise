export type Perm = "read" | "write";

export type AclRule = { user: string; perm: Perm; prefix: string };

/**
 * 前缀 ACL。起始实现未完成。
 */
export class Acl {
  constructor(_rules: AclRule[]) {
    throw new Error("not implemented");
  }

  check(_user: string, _perm: Perm, _key: string): boolean {
    throw new Error("not implemented");
  }
}
