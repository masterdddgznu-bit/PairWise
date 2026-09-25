请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个通用事件溯源基础设施任务（无业务域应用）：需要实现内存追加式事件存储、快照存储、聚合基类与示例 Counter 聚合、仓储（快照+重放 / 全量重放）、带幂等键的命令处理、以及可重建的投影。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；`occurredAt` 可用逻辑计数器。

模块划分：
- `src/types.ts`：`DomainEvent`、`Snapshot`、命令与结果类型
- `src/errors.ts`：`ConcurrencyError`、`AggregateNotFoundError` 等
- `src/event_store.ts`：内存 `EventStore`，按 aggregateId 有序流，append 时 `expectedVersion` 乐观并发控制
- `src/snapshot_store.ts`：内存 `SnapshotStore`，支持 corrupt 标记或无效快照检测
- `src/aggregate.ts`：`Aggregate` 基类与示例 `CounterAggregate`（仅测试/demo 用）
- `src/repository.ts`：load（快照+重放或全量重放）、save（append + OCC + 可选自动快照）
- `src/command_handler.ts`：`CommandHandler` 与幂等注册表（重复 commandId 不追加事件、返回先前结果）
- `src/projection.ts`：`Projection` 与 `ProjectionRunner`（订阅、project、rebuild；按 eventId 去重）
- `src/index.ts`：统一导出

语义要点：
1. `EventStore.append` 仅追加；若 `expectedVersion !==` 当前流版本则抛 `ConcurrencyError`（空流时期望 0）。
2. 事件在单 aggregate 流内按 `version` 有序；不同 aggregate 互不影响。
3. 重放可重建聚合；有有效快照时仅重放 `version > snapshot.version` 的事件。
4. 自动快照规则：当保存后 `version % snapshotThreshold === 0` 时写入快照（例如 threshold=5 则在 version 5、10… 快照）。
5.  corrupt / 无效快照（`valid === false` 或缺关键字段）→ 忽略快照、全量重放。
6. 相同 `commandId` 不得重复 append；应返回首次结果。
7. 投影跟踪已处理 `eventId`；rebuild 先清空再重放；重复 publish 同一 eventId 不得重复计数。
8. 零事件 aggregate：`Repository.load` 未知 id 应抛 `AggregateNotFoundError`；创建走命令路径。
9. 两 aggregate 并发写入互不干扰。

对外 API 以各模块公开类型与类为准（见 `src/index.ts`）。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
