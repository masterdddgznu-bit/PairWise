## 简述

实现进程内 FIFO 队列，并维护完成去重窗与毒丸集合：同 id 仍在队内则原地覆盖；刚离开队列且仍在去重窗内则拒绝；被毒丸标记且未清除/未过期的 id 亦拒绝入队；`drive` 同时清掉失效的去重记录与毒丸。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`DedupeQ`，以及错误类 `DedupeQError` 和至少 `InvalidConfigError` / `InvalidIdError` / `DuplicateRecentError` / `PoisonedError` / `CapacityError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new DedupeQ({
  clock,
  windowMs,
  poisonMs?: number,
  maxQueue?: number,
})
```

- `windowMs` 整数 `>= 1`（完成记录去重窗）。
- `poisonMs` 默认等于 `windowMs`、整数 `>= 1`（毒丸 TTL）。
- `maxQueue` 默认 16、整数 `>= 1`（仅计队列长度，不含 recent/poison 记录）。
- 非法配置抛 `InvalidConfigError`。

**完成记录**：id 经 `pop` 或成功 `cancel` 离开队列时写入 `completedAt = now`。仍有效当且仅当 `now - completedAt < windowMs`（`=== windowMs` 已失效）。

**毒丸记录**：`poison(id)` 写入/覆盖 `poisonedAt = now`。仍有效当且仅当 `now - poisonedAt < poisonMs`。`clearPoison(id)` 立即去掉毒丸（无论是否过期）。毒丸与队列位置独立：队内 id 也可被 poison，但队内更新仍允许。

**enqueue 判定不变量（顺序语义）**

对合法非空 id：先惰性清除所有已失效的完成记录与毒丸（不暴露给调用方），再：

1. 若 id **仍在队列**：覆盖 payload，返回 `{ status: 'updated' }`（位置不变；不检查 recent/poison/capacity）。
2. 否则若仍存在有效毒丸 → `PoisonedError`。
3. 否则若仍存在有效完成记录 → `DuplicateRecentError`。
4. 否则若队列长度已达 `maxQueue` → `CapacityError`。
5. 否则入队尾，`{ status: 'accepted' }`。

`enqueue` **不会**自动 `pop`。非法空 id → `InvalidIdError`。

`pop(): { id: string; payload: unknown } | null`

- 空队列 → `null`；否则取队头，写入/覆盖完成记录，**不**自动清毒丸。

`cancel(id): boolean`

- 非法 id → `InvalidIdError`。
- 在队列中则移除并写入完成记录，`true`；否则 `false`（不新建完成记录）。

`poison(id): void` / `clearPoison(id): boolean` / `isPoisoned(id): boolean`

- 非法 id 抛错。`poison` 始终登记毒丸（即便 id 不在队列）。`isPoisoned` 只看**仍有效**毒丸（过期未 `drive`/enqueue 懒清的不算有效）。`clearPoison` 有记录（含过期未清）则删除并 `true`，否则 `false`。

`drive(): { forgotten: string[]; detoxed: string[] }`

- 删除所有已失效完成记录 → `forgotten`；删除所有已失效毒丸 → `detoxed`。
- 两者各自排序：时间戳升序，同刻 id 字典序。
- 队列项不动。

查询：

- `ids()` / `size()` / `peek()`：队列 FIFO 视图。
- `recentIds()`：当前仍有效完成记录；完成时间升序，同刻字典序；不做副作用懒清。
- `poisonedIds()`：当前仍有效毒丸；毒丸时间升序，同刻字典序。
- `completedAtOf(id)` / `poisonedAtOf(id)`：无记录 → `null`；即使已过期未清仍返回原时间戳。

正确性以不变量与测试为准。宜拆成队列、去重窗、毒丸集合等多模块，但不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
