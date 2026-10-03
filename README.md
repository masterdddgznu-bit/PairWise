# admitctl

进程内 **多租户准入控制器**：全局并发上限、每租户 in-flight 上限、等待队列上的 DRR 公平调度、以及基于 `VirtualClock` 的排队超时。`src/` 仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
