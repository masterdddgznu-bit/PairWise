## 简述

实现进程内按 key 合并缓冲：同一 key 的写入合并为一条（后写覆盖）；key 在空闲足够久后经 `drive` 冲刷进就绪队列；`take` 只从就绪队列取；pending 与 ready 各有容量；可强制 flush 或 cancel。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`KeyFlush`，以及错误类 `KeyFlushError` 和至少 `InvalidConfigError` / `InvalidKeyError` / `CapacityError` / `UnknownKeyError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new KeyFlush({
  clock,
  idleMs,
  maxPending?: number,
  maxReady?: number,
})
```

- `idleMs` 整数 `>= 1`。
- `maxPending` 默认 16、`>= 1`（当前 **pending 的不同 key 数**）。
- `maxReady` 默认 16、`>= 1`（就绪队列条数）。
- 非法配置抛 `InvalidConfigError`。

`observe(key, payload): { status: 'accepted' | 'updated' }`

- `key` 非空字符串，否则 `InvalidKeyError`。
- 若 key 已在 pending：覆盖 payload，并把该 key 的 `lastAt` 更新为 `now`，返回 `{ status: 'updated' }`（空闲计时从头算）。
- 若 key 不在 pending：
  - pending key 数已达 `maxPending` → `CapacityError`。
  - 否则新建 pending，`lastAt = now`，返回 `{ status: 'accepted' }`。
- `observe` **不会**因时间流逝自动冲刷；也不会把条目放进 ready。

`flush(key): boolean`

- 非法 key → `InvalidKeyError`。
- key 不在 pending → `false`（不抛错；含已在 ready / 从未出现）。
- 若 ready 已满 → `CapacityError`（pending 保持不变）。
- 成功：从 pending 移除，按冲刷顺序进入 ready，`true`。

`drive(): { flushed: string[] }`

1. 找出 pending 中 `now >= lastAt + idleMs` 的 key，按 `lastAt` 升序，再 `key` 字典序。
2. 按该顺序尽量冲刷：每条进入 ready 尾；若 ready 已满则 **停止**（其余虽已到期仍留 pending）。
3. 返回本轮冲刷的 key 列表（冲刷顺序）。

`take(): { key: string; payload: unknown } | null`

- 只从 ready 队头取；成功后该条离开系统。
- 无 ready → `null`。
- `take` **不会**自动冲刷到期 pending。

`cancel(key): boolean`

- 非法 key → `InvalidKeyError`。
- 在 pending：删除，`true`。
- 在 ready：删除，`true`。
- 都不在：`false`。

查询：

- `pendingKeys(): string[]` 当前 pending，按 `lastAt` 再 key 字典序。
- `readyKeys(): string[]` 当前 ready，按冲刷进入顺序。
- `pendingCount()` / `readyCount()`
- `peekPending(key): unknown | undefined` 不在 pending 则 `undefined`（非法 key 仍 `InvalidKeyError`）。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
