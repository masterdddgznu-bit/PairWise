请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `OrderMux`：主入口类
- 错误类：`OrderMuxError`，以及至少  
  `InvalidConfigError` / `UnknownStreamError` / `StreamClosedError` /  
  `FenceError` / `InvalidSeqError` / `StreamLimitError`

## 构造

```ts
new OrderMux({
  clock: VirtualClock,
  bufSize: number,        // >= 1；每流乱序缓冲条数上限
  gapTimeoutMs: number,   // >= 1；期望 seq 缺口等待超时后跳过
  maxStreams?: number,    // 默认 32，>= 1
})
```

非法 → `InvalidConfigError`。

## 语义（验收以 tests 为准）

每个流维护：`gen`（从 1 起）、`next`（下一期望 seq，从 1 起）、乱序缓冲、`gapSince: number | null`（当 `next` 处有缺口且缓冲里存在更大 seq 时记录首次发现时刻；否则 null）、`closed`。

全局有一条 **交付队列**（跨流），`poll` 从中取。

### open / close / reset

- `open(streamId: string): { gen: number }`  
  - 非空 id；已存在未 closed → 抛错用 `InvalidSeqError`（表示非法请求）；  
  - 未 closed 流数达上限 → `StreamLimitError`；  
  - 曾 closed 的同 id 可重开：`gen = 上次 gen + 1`。

- `close(streamId, gen): boolean`  
  - 未知 → `UnknownStreamError`；错 gen → `FenceError`；已 closed → `false`；  
  - 成功：closed，清空该流缓冲；**不**清空全局已进入交付队列的条目；返回 `true`。

- `reset(streamId, gen): number`  
  - 未 closed；`gen+=1`；`next=1`；清空缓冲与 gapSince；返回新 gen。

### push

```ts
push(streamId, gen, seq, payload: string):
  'delivered' | 'buffered' | 'duplicate' | 'dropped'
```

- 校验流/gen/未 closed；`seq` 须为整数 `>= 1`，否则 `InvalidSeqError`。  
- `seq < next` → `'duplicate'`。  
- `seq === next`：立即交付到全局队列 `{ streamId, seq, payload }`，`next++`，然后尽量从缓冲弹出连续后续一并交付；清除或更新 `gapSince`；返回 `'delivered'`。  
- `seq > next`：  
  - 缓冲已有该 seq → `'duplicate'`；  
  - 若缓冲已满 → `'dropped'`（不覆盖）；  
  - 否则入缓冲；若此时 `gapSince === null` 则 `gapSince = now`；返回 `'buffered'`。

### drive / poll / 查询

- `drive(): { skipped: Array<{ streamId: string; seq: number }> }`  
  按 `streamId` **字典序**扫描未 closed 流：若 `gapSince !== null` 且 `now >= gapSince + gapTimeoutMs`：  
  - 跳过当前 `next`（计入 skipped，**不**产生 poll 条目），`next++`，然后尽量从缓冲连续交付（交付顺序随扫描顺序进入全局队列）；  
  - 若之后缓冲仍对更高 seq 有缺口则 `gapSince = now`，否则 `gapSince = null`。  
  - skipped 按 `(streamId 字典序, seq 升序)` 排序。

- `poll(maxn?: number): Array<{ streamId; seq; payload }>`  
  - 取出全局交付队列前缀；`maxn` 默认全部，若提供须 `>= 1`。

- `nextOf(streamId)` / `bufferedOf(streamId)` / `genOf(streamId)` / `openIds(): string[]`（字典序）  
  - 未知 → `UnknownStreamError`；closed 流仍可查询。

自行决定模块拆分；正确性以不变量与 tests 为准。
