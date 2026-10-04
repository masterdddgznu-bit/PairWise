请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `FanJoin`：主入口类
- 错误类：`FanJoinError`，以及至少  
  `InvalidConfigError` / `UnknownProducerError` / `InvalidSeqError`

## 构造

```ts
new FanJoin({
  clock: VirtualClock,
  producers: string[],   // 非空、唯一；内部按字典序固定
  bufSize: number,       // >= 1；每生产者乱序缓冲上限
  gapTimeoutMs: number,  // >= 1；缺口超时跳过
})
```

非法 → `InvalidConfigError`。

## 语义（验收以 tests 为准）

每个 producer 独立维护：`next`（期望 seq，从 1）、乱序缓冲、`gapSince`、以及已「落实」的槽位  
`slots[seq] = { kind: 'value', payload } | { kind: 'skipped' }`。

全局 `joinNext` 从 1 起：当**所有** producer 在 `joinNext` 都已有落实槽位时，生成一条接合事件并 `joinNext++`（可连续推进）。

### push

```ts
push(producer: string, seq: number, payload: string):
  'accepted' | 'duplicate' | 'dropped'
```

- 未知 producer → `UnknownProducerError`；`seq` 非整数或 `<1` → `InvalidSeqError`。  
- `seq < next` → `'duplicate'`。  
- `seq === next`：落实为 value 槽，`next++`，清空/更新 gapSince，并尽量从缓冲连续落实；然后尝试推进 join；返回 `'accepted'`。  
- `seq > next`：缓冲已有 → `'duplicate'`；缓冲满 → `'dropped'`；否则入缓冲，若 `gapSince==null` 则 `gapSince=now`；返回 `'accepted'`（注意：buffered 也返回 accepted，与 dropped/duplicate 区分）。

### drive / poll

- `drive(): { skipped: Array<{ producer: string; seq: number }> }`  
  按 producer **字典序**：若 `gapSince!=null` 且 `now >= gapSince + gapTimeoutMs`：  
  - 将当前 `next` 落实为 `skipped` 槽（不进入 value），`next++`，再尽量从缓冲连续落实 value；  
  - 若仍存在更高 seq 缓冲则 `gapSince=now`，否则 `null`；  
  - 每跳过一次记入 skipped；然后尝试推进 join。  
  skipped 按 `(producer 字典序, seq 升序)`。

- `poll(maxn?: number): JoinEvent[]`  
  ```ts
  type JoinEvent = {
    seq: number;
    values: Record<string, string>; // 仅有 value 的 producer
    missing: string[];              // skipped 的 producer，字典序
  }
  ```
  取出接合队列前缀；`maxn` 默认全部，若给则 `>=1`。

### 查询

- `nextOf(producer)` / `bufferedOf(producer)` / `joinNext()` / `producers(): string[]`（字典序拷贝）  
  未知 producer → `UnknownProducerError`。

自行决定模块拆分；正确性以不变量与 tests 为准。
