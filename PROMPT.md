## 简述

实现进程内能力链：可以 mint 根能力，再派生出路径更窄、操作更少的子能力；撤销或到期会让子孙一并失效。子能力续租不能救已经到期的祖先。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`CapChain`，以及错误类 `CapChainError` 和至少 `InvalidConfigError` / `InvalidMintError` / `InvalidDeriveError` / `UnknownCapError` / `InvalidRevokeError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new CapChain({ clock, ttlMs, maxChildren?: number })
```

- `ttlMs >= 1`；`maxChildren` 默认 8、`>= 1`（每个能力直接子节点上限）。非法配置抛 `InvalidConfigError`。

路径：非空字符串。`path` 落在能力 `prefix` 下，当且仅当 `path === prefix`，或 `prefix === "/"` 且 `path` 以 `/` 开头，或 `path` 以 `prefix + "/"` 开头。

`mint(holderId, prefix, ops: string[]): number` 返回 `capId`（全局从 1 递增）。

- `holderId` 非空；`prefix` 非空；`ops` 去重后至少 1 个非空字符串。否则 `InvalidMintError`。
- 新能力无父节点，`deadline = now + ttlMs`，未撤销。

`derive(holderId, parentId, prefix, ops: string[]): number` 返回子 `capId`。

- 未知父 `UnknownCapError`。
- `holderId` 必须是父能力当前 holder，否则 `InvalidDeriveError`。
- 父已撤销或已到期（`now >= deadline`）→ `InvalidDeriveError`。
- 子 `prefix` 必须落在父 `prefix` 下；子 `ops` 去重后非空且每个都是父 ops 的成员（不得扩权）。否则 `InvalidDeriveError`。
- 父的直接子数量已达 `maxChildren` → `InvalidDeriveError`。
- 子 holder 与父相同；子 `deadline = now + ttlMs`（独立计时，但祖先失效仍会让子 check 失败）。

`check(capId, path, op): boolean`

- 未知 `capId` → `UnknownCapError`。
- 自身或任一祖先已撤销或已到期 → `false`。
- `path` 不在该能力 prefix 下，或 `op` 不在其 ops 中 → `false`。
- 否则 `true`。

`heartbeat(holderId, capId): boolean` 匹配未撤销且未到期的持有则续 `deadline = now + ttlMs` 并 `true`；未知 `UnknownCapError`；holder 不匹配或已撤销/已到期 → `false`。

`revoke(holderId, capId): boolean` 匹配未撤销的持有则将该能力及其 **全部子孙** 标为撤销并 `true`；未知 `UnknownCapError`；holder 不匹配或已经撤销 → `false`。已到期未撤销的仍可 revoke（返回 `true`，子孙一并标撤销）。

`drive()`：

1. 将所有 `now >= deadline` 且尚未因到期处理过的能力视为到期（自身到期即失效，check 已含祖先传播）。
2. 返回 `{ expired: number[] }`：本轮 **新发现** 自身到期的 `capId` 升序（不含仅因祖先到期而失效、自身尚未到点的子孙）。

查询：

- `holderOf(capId): string` 未知则 `UnknownCapError`。
- `prefixOf(capId): string` 同上。
- `opsOf(capId): string[]` 字典序，同上。
- `parentOf(capId): number | null` 根为 `null`，同上。
- `childrenOf(capId): number[]` 直接子 `capId` 升序，同上。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
