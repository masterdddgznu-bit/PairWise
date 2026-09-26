# jobsched

进程内任务调度器作业：DAG 依赖、worker 租约声明/心跳/窃取、失败退避重试、journal 崩溃恢复。各模块已接好并能跑通简单 happy path；组合依赖就绪、租约边界、fencing token、重试时刻与 crash/recover 时行为不一致。

修好后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
