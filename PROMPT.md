请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。哈希必须用下方指定算法（无随机）。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `ShardBag`：主入口类
- `fnv1aShard(key: string, shardCount: number): number`：分片函数（见下）
- 错误类：`ShardBagError`，以及至少  
  `InvalidConfigError` / `InvalidJobError` / `UnknownTicketError` / `FenceError`

## 哈希

对非空 `key`，FNV-1a 32-bit：

```
h = 2166136261
for each uint16 code unit c in key:
  h = (h XOR c) * 16777619   // 乘法后取 uint32（>>> 0）
return h % shardCount
```

`shardCount < 1` 或空 key → 由调用方保证；`fnv1aShard` 在 `shardCount < 1` 或空 key 时抛 `InvalidJobError`。

## 构造

```ts
new ShardBag({
  clock: VirtualClock,
  shardCount: number,     // >= 1
  leaseMs: number,        // >= 1
  maxPerShard?: number,   // 默认 64，>= 1；每片 ready+delayed+running 总数上限
})
```

非法 → `InvalidConfigError`。

## 语义（验收以 tests 为准）

任务状态：`delayed | ready | running | done | cancelled`。

### enqueue

```ts
enqueue(key: string, payload: string, opts?: {
  priority?: number;  // 默认 0；越大越优先（同片内）
  delayMs?: number;   // >= 0；默认 0
}): number  // ticket，全局从 1 递增
```

- 空 key / 非 string payload → `InvalidJobError`。  
- `shard = fnv1aShard(key, shardCount)`；若该片任务数（非 cancelled/done？**约定：status 为 delayed|ready|running 的计数**）已达 `maxPerShard` → `InvalidJobError`。  
- `delayMs>0` → delayed，`readyAt=now+delayMs`；否则 ready，`readyAt=now`。  
- 记住 `key`/`shard`/`priority`。

### claim（跨片公平）

维护 `cursor`（初始 0）。`claim()`：

1. 从 `i = 0..shardCount-1`，考察片 `s = (cursor + i) % shardCount`；  
2. 在该片所有 `ready` 且 `now >= readyAt` 中选：`priority` 降序，同等 `ticket` 升序；  
3. 若找到：标 `running`，`attempt` 不需要；分配 `fence`（全局递增），`leaseDeadline=now+leaseMs`；令 `cursor = (s + 1) % shardCount`；返回  
   `{ ticket, fence, shard, key, payload, priority }`；  
4. 所有片都无 → `undefined`（cursor 不变）。

### heartbeat / complete / fail / cancel

- `heartbeat(ticket, fence): boolean`：running 且匹配 → 续租；错 fence → `FenceError`；未知 → `UnknownTicketError`；其它 `false`。  
- `complete(ticket, fence): boolean`：匹配 running → `done`，`true`；规则同 heartbeat。  
- `fail(ticket, fence): boolean`：匹配 running → 回**同一 shard** 的 `ready`（`readyAt=now`），清除 fence，`true`。  
- `cancel(ticket): boolean`：`ready`/`delayed` → `cancelled`；running/终态 → `false`；未知 → `UnknownTicketError`。

### drive

```ts
drive(): { requeued: number[]; becameReady: number[] }
```

先：running 且租约到期 → 回同片 `ready`（`readyAt=now`，旧 fence 失效），计入 requeued。  
再：delayed 且 `now >= readyAt` → `ready`，计入 becameReady。  
两数组 ticket 升序。

### 查询

- `shardOfKey(key)` → `fnv1aShard`  
- `status(ticket)` / `shardOf(ticket)` / `readyOn(shard): number[]`（该片当前可 claim 的 ticket 升序）  
- `cursor(): number`

自行决定模块拆分；正确性以不变量与 tests 为准。
