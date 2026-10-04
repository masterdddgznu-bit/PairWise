请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`（用于记录 `publishedAt`，不参与淘汰逻辑以外的调度）。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `RingBuf`：主入口类
- 错误类：`RingBufError`，以及至少  
  `InvalidConfigError` / `UnknownConsumerError` / `InvalidRequestError`

## 构造

```ts
new RingBuf({
  clock: VirtualClock,
  capacity: number,  // >= 1；环形槽位数
})
```

非法 → `InvalidConfigError`。初始：下一发布 `seq = 1`；缓冲空；无消费者。

## 语义（验收以 tests 为准）

缓冲保存最近至多 `capacity` 条：`{ seq, payload, publishedAt }`。  
令 `oldest` 为仍保留的最小 seq（空则无）；`newest` 为已发布最大 seq（从未发布则为 0）。

当发布使条数将超过 capacity 时：**覆盖/丢弃最旧**一条（`oldest` 前进）。

### subscribe / unsubscribe

- `subscribe(consumerId: string): { gen: number; nextSeq: number }`  
  - 非空 id；若已存在未退订消费者 → `InvalidRequestError`。  
  - 新消费者 `gen` 从 1 起；同 id 退订后再订 `gen+=1`。  
  - `nextSeq`：**若缓冲非空则为 `oldest`，否则为即将发布的下一 seq（即 `newest+1`）**——即从当前仍可读的最旧数据开始；空环则等待未来第一条。

- `unsubscribe(consumerId, gen): boolean`  
  - 未知 → `UnknownConsumerError`；错 gen → `InvalidRequestError`；成功移除 `true`。

### publish / read

- `publish(payload: string): { seq: number; overwritten: number | null; lagged: string[] }`  
  - payload 须为 string，否则 `InvalidRequestError`。  
  - 分配 `seq = newest+1`，写入环；若发生覆盖，`overwritten = 被丢弃的 seq`，否则 `null`。  
  - 对每个消费者：若其 `nextSeq < oldest`（已被覆盖甩开），则将 `nextSeq` **追赶到 `oldest`**，并把该 `consumerId` 记入 `lagged`（字典序）。  
  - 返回新 seq。

- `read(consumerId, gen, maxn?: number): Array<{ seq; payload; publishedAt }>`  
  - 校验消费者/gen；`maxn` 默认 1，须 `1..capacity`。  
  - 从 `nextSeq` 起依次读出仍在缓冲中的连续条目，最多 `maxn` 条；每读一条 `nextSeq++`。  
  - 若 `nextSeq < oldest`（极端未 publish 追赶）：先追赶到 `oldest` 再读（本次 read 不把 id 放入 lagged，仅 publish 报告 lagged）。  
  - 若下一条尚未发布（`nextSeq > newest`）则停止。

### 查询

- `oldest()` / `newest()`：空环时 `oldest()` 为 `null`，`newest()` 为 `0`。  
- `nextSeqOf(consumerId)` / `genOf(consumerId)`  
- `size()`：当前缓冲条数  
- `consumers(): string[]` 字典序

自行决定模块拆分；正确性以不变量与 tests 为准。
