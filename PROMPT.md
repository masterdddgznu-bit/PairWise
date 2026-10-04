## 简述

实现进程内世代封口袋：写入只进入当前 open 世代并按 key 后写覆盖；手动 `seal` 或空闲超时经 `drive` 封口；`take` 只从已封口、尚未排空的世代按该世代内首次写入顺序取出。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SealBag`，以及错误类 `SealBagError` 和至少 `InvalidConfigError` / `InvalidKeyError` / `CapacityError` / `UnknownEpochError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SealBag({
  clock,
  idleMs,
  maxOpenKeys?: number,
})
```

- `idleMs` 整数 `>= 1`。
- `maxOpenKeys` 默认 16、整数 `>= 1`（**当前 open 世代**里不同 key 数上限）。
- 非法配置抛 `InvalidConfigError`。
- 初始当前世代为 `1`，状态 `open`。

`put(key, payload): { epoch: number; status: 'accepted' | 'updated' }`

- `key` 非空，否则 `InvalidKeyError`。
- 只写入**当前 open 世代**。
- 该世代已有该 key：覆盖 payload，并把该世代的 `lastPutAt` 更新为 `now`，返回 `{ epoch, status: 'updated' }`。**不改变**该 key 在取出顺序中的位置。
- 新 key：若不同 key 数已达 `maxOpenKeys` → `CapacityError`；否则追加到取出顺序尾，`lastPutAt = now`，`accepted`。
- 空世代第一次 `put` 也设置 `lastPutAt`。
- `put` **不会**因时间流逝自动封口。

`seal(): { epoch: number }`

- 将当前 open 世代封为 `sealed`（即使没有任何 key）。
- 立即打开 `epoch+1`（空、open，无 `lastPutAt`）。
- 若被封世代 **没有 key**，该世代立刻变为 `drained`（没有可 take 的条目）。
- 返回被封的世代号。

`drive(): { sealed: number | null }`

- 仅当当前 open 世代 **至少有 1 个 key**，且已有 `lastPutAt`，且 `now >= lastPutAt + idleMs`：执行与 `seal` 相同的封口，返回 `{ sealed: 被封世代 }`。
- 一轮 `drive` 最多封口 **一个**世代。空世代即使时间流逝也不自动封。
- 不满足条件 → `{ sealed: null }`。

`take(): { epoch: number; key: string; payload: unknown } | null`

- 在所有状态为 `sealed` 的世代中，选世代号最小者，取其剩余队列队头（该世代内 **首次 put 该 key 的顺序**）。
- 取出后该 key 离开系统；若该世代队列空了 → 状态 `drained`。
- 没有 sealed 且仍有剩余条目 → `null`（open 世代不可 take）。
- `take` **不会**自动封口。

`cancel(key): boolean`

- 非法 key → `InvalidKeyError`。
- 只取消 **当前 open** 世代中的 key：有则删除（释放容量、从顺序中去掉），`true`。
- 已封口世代中的 key 不能 cancel → `false`。
- open 中无该 key → `false`。
- 若 cancel 后 open 世代空了，清除 `lastPutAt`（之后须重新 put 才开始空闲计时）。

查询：

- `currentEpoch(): number`
- `statusOf(epoch): 'open' | 'sealed' | 'drained'` 从未出现过的世代 → `UnknownEpochError`。
- `openKeys(): string[]` 当前 open 世代 key，按首次写入序。
- `readyCount(): number` 所有 sealed 世代中尚未 take 的条目总数。
- `peekOpen(key): unknown | undefined` 只看 open；非法 key 抛错。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
