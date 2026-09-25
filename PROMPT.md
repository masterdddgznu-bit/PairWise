请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个确定性分布式租约协调模拟器：需要实现多资源租约获取/续期/释放/过期、每资源严格递增的 fencing token、客户端带栅栏写入，以及基于租约的选主。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

模块划分：
- `src/clock.ts`：`VirtualClock`（`now` / `advance`）
- `src/errors.ts`：类型化错误（`NotOwnerError`、`StaleTokenError`、`LeaseNotFoundError`、`AlreadyHeldError`、`NotLeaderError` 等）
- `src/fencing.ts`：`FencingTokenRegistry`，每资源严格单调递增 token（从 1 起）
- `src/lease.ts`：租约值对象（`resourceId`、`ownerId`、`token`、`acquiredAt`、`expireAt`）
- `src/resource.ts`：单资源租约状态
- `src/lease_manager.ts`：多资源 acquire / renew / release / expire 语义
- `src/client.ts`：绑定 `clientId` + manager + clock 的客户端门面（含 `fencedWrite`）
- `src/leader_election.ts`：基于租约的选主（资源键如 `election:{electionId}`），`write` 受 fencing token 约束
- `src/index.ts`：统一导出

对外 API 以 `LeaseManager`、`Client`、`LeaderElection` 为准（见各模块公开类）。租约有效条件：`now < expireAt`（`now === expireAt` 视为已过期）。每次新 ownership 须生成严格递增 fencing token；旧 token 的写入必须永久拒绝（即使资源已释放或空闲）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
