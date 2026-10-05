## 简述

实现进程内幂等发件箱：按 topic 追加消息；同 topic 的 idemKey 在 TTL 内重复发布不落新消息；消费组用位点 `poll/commit`；过期幂等键经 `drive` 清理；成功变更写入 WAL，可用 `fromJournal` 恢复。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`IdemBox`、`IdemBox.fromJournal`，以及错误类 `IdemBoxError` 和至少 `InvalidConfigError` / `InvalidArgError` / `CapacityError` / `StateError` / `UnknownError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new IdemBox({
  clock,
  idemTtlMs,
  maxTopics?: number,
  maxDepth?: number,
  maxIdem?: number,
})
```

- `idemTtlMs` 整数 `>= 1`。
- `maxTopics` 默认 8、`maxDepth` 默认 32、`maxIdem` 默认 64；均为整数 `>= 1`。
- 非法配置 → `InvalidConfigError`。

**发布与幂等**

- `publish(topic, idemKey, payload): { seq: number; duplicate: boolean }`
  - `topic`/`idemKey` 非空，否则 `InvalidArgError`。
  - 若该 `(topic,idemKey)` 仍在幂等窗内（`now < expireAt`）：不入队，返回首次 `seq` 且 `duplicate: true`，并记一条可审计的重复记录到 WAL。
  - 否则：在 topic 日志追加新消息，分配该 topic 从 1 起的单调 `seq`，写入幂等窗 `expireAt = now + idemTtlMs`，`duplicate: false`。
  - 新 topic 超 `maxTopics`、单 topic 深度超 `maxDepth`、幂等条目超 `maxIdem` → `CapacityError`（失败不写 WAL）。

**消费**

- `poll(group, topic, maxn): Array<{ seq, idemKey, payload }>`：返回该 group 在 topic 上 **已提交位点之后** 的消息（`seq > offset`），最多 `maxn` 条，按 seq 升序。`maxn` 整数 `>= 1`。默认 offset 为 0。不修改位点、不写 WAL。
- `commit(group, topic, seq)`：位点单调不减（允许相同 seq 重放提交）；`seq` 必须 `>= 1` 且不得超过该 topic 当前最大已发布 seq，否则 `StateError`/`InvalidArgError`。成功写 WAL。
- `offsetOf(group, topic)`：当前已提交 seq（默认 0）。

**过期**

- `drive(): { expired: Array<{ topic, idemKey }> }`：清除所有 `now >= expireAt` 的幂等条目；返回列表按 topic 再 idemKey 字典序；若非空则写 WAL。过期后同一 idemKey 可再次 `publish` 出新 seq。

**查询**：`depth(topic)`、`topics()`（首次出现序）。

**WAL 双真相**

- 成功变更追加日志；失败抛错不追加。
- `journal()` / `IdemBox.fromJournal(clock, opts, entries)`：重放后队列内容、位点、幂等窗与源实例可观测行为一致（含后续 publish/poll/commit）。

正确性以不变量与测试为准。宜拆多模块，不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
